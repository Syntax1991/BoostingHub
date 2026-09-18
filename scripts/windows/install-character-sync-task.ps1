#Requires -Version 5.1
<#
.SYNOPSIS
  Install or update the Windows Task Scheduler job for BoostingHub character sync.

.DESCRIPTION
  Idempotent: creates or updates the single task named "BoostingHub Character Sync".
  Runs every 15 minutes (external tick). Application stale threshold remains 120 minutes.
  Gates installation on a successful `npm run sync:characters -- --dry-run`.
  No secrets or credentials are stored in the task definition.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "character-sync-task.common.ps1")

$repoRoot = Get-BoostingHubRepoRoot
Set-Location -LiteralPath $repoRoot

Write-Host "Repository root: $repoRoot"
Write-Host "Task name:       $($script:CharacterSyncTaskName)"
Write-Host "Interval:        $($script:CharacterSyncIntervalMinutes) minutes (scheduler tick; stale threshold stays 120)"

try {
  $null = Resolve-NpmCmdPath
} catch {
  Write-Error $_.Exception.Message
  exit 1
}

Write-Host ""
Write-Host "Pre-install dry-run: npm run sync:characters -- --dry-run"
& (Join-Path $PSScriptRoot "run-character-sync-task.ps1") -DryRun
if ($LASTEXITCODE -ne 0) {
  Write-Error "Dry-run failed (exit $LASTEXITCODE). Scheduled task was NOT installed or updated."
  exit $LASTEXITCODE
}
Write-Host "Dry-run OK."

$definition = Get-CharacterSyncTaskActionDefinition -RepoRoot $repoRoot
if (-not (Test-Path -LiteralPath $definition.WrapperPath)) {
  Write-Error "Wrapper missing: $($definition.WrapperPath)"
  exit 1
}

$action = New-ScheduledTaskAction `
  -Execute $definition.Execute `
  -Argument $definition.Arguments `
  -WorkingDirectory $definition.WorkingDirectory

# Begin shortly after install; repeat every 15 minutes for a long horizon (no practical end date).
# TimeSpan.MaxValue is rejected by Task Scheduler XML validation.
$start = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At $start `
  -RepetitionInterval (New-TimeSpan -Minutes $script:CharacterSyncIntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 9999)

# Defense-in-depth: do not start a new instance if one is still running.
# Correctness still comes from the app PostgreSQL advisory lock.
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$existing = Get-CharacterSyncTask
try {
  if ($null -eq $existing) {
    Register-ScheduledTask `
      -TaskName $script:CharacterSyncTaskName `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Principal $principal `
      -Description "One-shot BoostingHub Blizzard character sync (npm run sync:characters) every $($script:CharacterSyncIntervalMinutes) minutes. App owns no timer." `
      -Force | Out-Null
    Write-Host "Created scheduled task '$($script:CharacterSyncTaskName)'."
  } else {
    Set-ScheduledTask `
      -TaskName $script:CharacterSyncTaskName `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Principal $principal | Out-Null
    Write-Host "Updated scheduled task '$($script:CharacterSyncTaskName)' (idempotent)."
  }
} catch {
  $msg = $_.Exception.Message
  if ($msg -match "Access is denied|Zugriff verweigert|0x80070005") {
    Write-Error "Failed to register the scheduled task (access denied). Re-run from an elevated PowerShell if your policy requires it. Do not embed a Windows password. Detail: $msg"
  } else {
    Write-Error "Failed to register scheduled task: $msg"
  }
  exit 1
}

Write-Host ""
Write-Host "Install complete. Run status with:"
Write-Host "  .\scripts\windows\status-character-sync-task.ps1"
exit 0
