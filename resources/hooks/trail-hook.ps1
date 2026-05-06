# Trail shell hook for PowerShell.
# Append to your $PROFILE:
#   . "C:\path\to\trail-hook.ps1"
# Or copy-paste contents into $PROFILE.
#
# Pings Trail's local HTTP endpoint at session start so the app can track
# which shell sessions you have open and what you're working on.

$global:TrailEndpoint = "http://127.0.0.1:47123"

function Invoke-TrailRequest {
  param([string]$Path, [hashtable]$Body)
  try {
    $json = $Body | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$global:TrailEndpoint$Path" -Method POST `
      -Body $json -ContentType "application/json" `
      -TimeoutSec 1 -ErrorAction Stop | Out-Null
  } catch {
    # Trail not running — silently ignore.
  }
}

function Get-TrailContext {
  $cwd = (Get-Location).Path
  $repo = $null
  $branch = $null
  try {
    $top = git rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $top) {
      $repo = Split-Path -Leaf $top
      $branch = git rev-parse --abbrev-ref HEAD 2>$null
    }
  } catch {}

  return @{
    shell  = "pwsh"
    cwd    = $cwd
    pid    = $PID
    host   = $env:COMPUTERNAME
    user   = $env:USERNAME
    repo   = $repo
    branch = $branch
  }
}

# Fire session-start at profile load
Invoke-TrailRequest -Path "/session/start" -Body (Get-TrailContext)

# Fire session-end on shell exit
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
  Invoke-TrailRequest -Path "/session/end" -Body (Get-TrailContext)
} | Out-Null

# Manual helpers
function trail-task {
  param([Parameter(Mandatory)][string]$Title, [string[]]$Tags)
  Invoke-TrailRequest -Path "/task" -Body @{
    title = $Title
    tags  = $Tags
  }
}

function trail-context {
  Invoke-TrailRequest -Path "/session/start" -Body (Get-TrailContext)
}
