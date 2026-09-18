#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot wrapper invoked by Windows Task Scheduler for Blizzard character sync.

.DESCRIPTION
  Sets the working directory to the repository root, resolves npm.cmd, and runs
  the existing application command: npm run sync:characters
  Optional -DryRun passes --dry-run. Appends a bounded local log summary.
  Does not implement sync/candidate logic and embeds no secrets.
#>
[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "character-sync-task.common.ps1")

$repoRoot = Get-BoostingHubRepoRoot
Set-Location -LiteralPath $repoRoot

$logPath = Ensure-CharacterSyncLogDirectory -RepoRoot $repoRoot
Rotate-CharacterSyncLogIfNeeded -LogPath $logPath

$npmCmd = Resolve-NpmCmdPath
$npmArgs = @("run", "sync:characters")
if ($DryRun) {
  $npmArgs += @("--", "--dry-run")
}

$mode = if ($DryRun) { "dry-run" } else { "sync" }
Write-CharacterSyncLog -LogPath $logPath -Message "START mode=$mode cwd=$repoRoot npm=$npmCmd"

# Capture combined output without Start-Process redirects (unreliable for .cmd).
$transcript = [System.Collections.Generic.List[string]]::new()
$exitCode = 0
try {
  $output = & $npmCmd @npmArgs 2>&1
  $exitCode = $LASTEXITCODE
  foreach ($line in @($output)) {
    $text = if ($null -eq $line) { "" } else { [string]$line }
    $transcript.Add($text)
    Write-Host $text
  }
} catch {
  $exitCode = 1
  $err = $_.Exception.Message
  $transcript.Add($err)
  Write-Error $err
}

if ($transcript.Count -gt 0) {
  Write-CharacterSyncLog -LogPath $logPath -Message ("OUTPUT`n" + ($transcript -join "`n"))
}

Write-CharacterSyncLog -LogPath $logPath -Message "END exitCode=$exitCode mode=$mode"
exit $exitCode
