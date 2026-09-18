# Shared helpers for BoostingHub Windows character-sync Task Scheduler tooling.
# Dot-sourced by install / status / remove / run scripts. No secrets.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Stable Task Scheduler name - do not version or rename casually.
$script:CharacterSyncTaskName = "BoostingHub Character Sync"

# External scheduler tick (retry/check cadence). Not the Character stale threshold.
$script:CharacterSyncIntervalMinutes = 15

# Log under repo .local/ (gitignored). Keep rotation simple.
$script:CharacterSyncLogRelativePath = ".local\logs\character-sync.log"
$script:CharacterSyncLogMaxBytes = 8MB

# Capture scripts/windows at load time (dot-sourced $PSScriptRoot is not reliable later).
$script:WindowsScriptsDir = $PSScriptRoot

function Get-BoostingHubRepoRoot {
  <#
  .SYNOPSIS
    Resolve repository root from this scripts/windows folder (no hardcoded machine path).
  #>
  $root = Resolve-Path -LiteralPath (Join-Path $script:WindowsScriptsDir "..\..")
  return [string]$root.Path
}

function Resolve-NpmCmdPath {
  <#
  .SYNOPSIS
    Locate npm.cmd via PATH (Get-Command). Fail loudly if missing.
  #>
  $cmd = Get-Command -Name "npm.cmd" -ErrorAction SilentlyContinue
  if (-not $cmd -or [string]::IsNullOrWhiteSpace($cmd.Source)) {
    throw "npm.cmd was not found on PATH. Install Node.js/npm or open a shell where npm is available, then retry."
  }
  return [string]$cmd.Source
}

function Get-CharacterSyncLogPath {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)
  return Join-Path $RepoRoot $script:CharacterSyncLogRelativePath
}

function Ensure-CharacterSyncLogDirectory {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)
  $logPath = Get-CharacterSyncLogPath -RepoRoot $RepoRoot
  $dir = Split-Path -Parent $logPath
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  return $logPath
}

function Rotate-CharacterSyncLogIfNeeded {
  param([Parameter(Mandatory = $true)][string]$LogPath)
  if (-not (Test-Path -LiteralPath $LogPath)) {
    return
  }
  $item = Get-Item -LiteralPath $LogPath
  if ($item.Length -lt $script:CharacterSyncLogMaxBytes) {
    return
  }
  $previous = "$LogPath.1"
  if (Test-Path -LiteralPath $previous) {
    Remove-Item -LiteralPath $previous -Force
  }
  Move-Item -LiteralPath $LogPath -Destination $previous -Force
}

function Write-CharacterSyncLog {
  param(
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss K")
  Add-Content -LiteralPath $LogPath -Value "[$stamp] $Message" -Encoding utf8
}

function Get-CharacterSyncTask {
  <#
  .SYNOPSIS
    Return the scheduled task object or $null if absent.
  #>
  try {
    return Get-ScheduledTask -TaskName $script:CharacterSyncTaskName -ErrorAction Stop
  } catch {
    return $null
  }
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CharacterSyncWrapperPath {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)
  return Join-Path $RepoRoot "scripts\windows\run-character-sync-task.ps1"
}

function Get-CharacterSyncTaskActionDefinition {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)
  $wrapper = Get-CharacterSyncWrapperPath -RepoRoot $RepoRoot
  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  # -File runs the wrapper; wrapper sets location to repo root and invokes npm.
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`""
  return [pscustomobject]@{
    Execute          = $ps
    Arguments        = $arguments
    WorkingDirectory = $RepoRoot
    WrapperPath      = $wrapper
  }
}
