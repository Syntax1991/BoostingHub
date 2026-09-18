#Requires -Version 5.1
<#
.SYNOPSIS
  Report operational status of the BoostingHub Character Sync scheduled task.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "character-sync-task.common.ps1")

$repoRoot = Get-BoostingHubRepoRoot
$task = Get-CharacterSyncTask

Write-Host "=== BoostingHub Character Sync - status ==="
Write-Host "Repository root: $repoRoot"
Write-Host "Task name:       $($script:CharacterSyncTaskName)"
Write-Host ""

if ($null -eq $task) {
  Write-Host "task exists:     NO"
  Write-Host "enabled:         N/A"
  Write-Host "state:           NotInstalled"
  Write-Host ""
  Write-Host "Application policy from docs/defaults - no secrets printed:"
  Write-Host "  scheduler tick:     $($script:CharacterSyncIntervalMinutes) minutes"
  Write-Host "  stale threshold:    120 minutes via BLIZZARD_SYNC_STALE_MINUTES, unset defaults to 120"
  Write-Host "  manual cooldown:    about 60 seconds, separate"
  Write-Host "  internal timer:     NONE"
  exit 0
}

$info = Get-ScheduledTaskInfo -TaskName $script:CharacterSyncTaskName
$enabled = if ($task.Settings.Enabled) { "YES" } else { "NO" }

$actionLines = @()
foreach ($a in @($task.Actions)) {
  $wd = if ($a.PSObject.Properties.Name -contains "WorkingDirectory") { $a.WorkingDirectory } else { "" }
  $actionLines += "Execute=$($a.Execute) Arguments=$($a.Arguments) WorkingDirectory=$wd"
}

$interval = "unknown"
foreach ($t in @($task.Triggers)) {
  if ($t.Repetition -and $t.Repetition.Interval) {
    # ISO 8601 duration e.g. PT15M
    $interval = [string]$t.Repetition.Interval
    break
  }
}

$logPath = Get-CharacterSyncLogPath -RepoRoot $repoRoot

Write-Host "task exists:     YES"
Write-Host "enabled:         $enabled"
Write-Host "state:           $($task.State)"
Write-Host "last run time:   $($info.LastRunTime)"
Write-Host "last result:     $($info.LastTaskResult)"
Write-Host "next run time:   $($info.NextRunTime)"
Write-Host "interval:        $interval (expected PT15M / 15 minutes)"
Write-Host "task action:"
foreach ($line in $actionLines) {
  Write-Host "  $line"
}
Write-Host ""
Write-Host "Application policy from docs/defaults - no secrets printed:"
Write-Host "  scheduler tick:     $($script:CharacterSyncIntervalMinutes) minutes"
Write-Host "  stale threshold:    120 minutes via BLIZZARD_SYNC_STALE_MINUTES, unset defaults to 120"
Write-Host "  manual cooldown:    about 60 seconds, separate"
Write-Host "  internal timer:     NONE"
Write-Host "  log path:           $logPath"

exit 0
