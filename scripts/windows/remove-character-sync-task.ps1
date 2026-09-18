#Requires -Version 5.1
<#
.SYNOPSIS
  Remove only the BoostingHub Character Sync scheduled task (idempotent).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "character-sync-task.common.ps1")

$task = Get-CharacterSyncTask
if ($null -eq $task) {
  Write-Host "Scheduled task '$($script:CharacterSyncTaskName)' is not installed."
  exit 0
}

try {
  Unregister-ScheduledTask -TaskName $script:CharacterSyncTaskName -Confirm:$false
  Write-Host "Removed scheduled task '$($script:CharacterSyncTaskName)'."
} catch {
  $msg = $_.Exception.Message
  if ($msg -match "Access is denied|Zugriff verweigert|0x80070005") {
    Write-Error "Failed to remove the scheduled task (access denied). Re-run elevated if required. Detail: $msg"
  } else {
    Write-Error "Failed to remove scheduled task: $msg"
  }
  exit 1
}

exit 0
