<#
  Make sure the board's local server is running, and optionally open the board.

    start-board.ps1          start it if it is not already running (used at login)
    start-board.ps1 -Open    the same, then open the board in the browser
                             (used by the desktop shortcut)

  Why this exists: the board is files on this laptop, and a browser can only open
  them while tools/serve.py is running. Started by hand, it stopped whenever its
  window was closed, the laptop restarted, or a session ended - and the board then
  showed "can't reach this page" with nothing to say why.

  So this runs it HIDDEN - there is no window to close by accident - and it is safe
  to run any number of times: if the board is already being served, it does
  nothing. Its output goes to output/ (gitignored), so if it ever fails there is
  something to read.

  Always port 8010. The browser saves the board per ADDRESS, so a different port is
  a different, empty board.
#>
param([switch]$Open)

$ErrorActionPreference = 'Stop'
$port = 8010
$url = "http://localhost:$port/"
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root 'output'

function Test-Board {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Board)) {
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $python = (Get-Command python -ErrorAction SilentlyContinue).Source
  if (-not $python) {
    throw 'Python was not found, so the board cannot be served. Is it installed?'
  }
  Start-Process -FilePath $python `
    -ArgumentList @('tools/serve.py', "$port") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs 'board-server.log') `
    -RedirectStandardError (Join-Path $logs 'board-server-errors.log')

  # Wait for it before opening the browser. The first start after a login can
  # take well over ten seconds; opening too early shows "can't reach this page"
  # for a board that is in fact on its way. Up to about half a minute.
  for ($i = 0; $i -lt 60 -and -not (Test-Board); $i++) { Start-Sleep -Milliseconds 500 }
}

if ($Open) { Start-Process $url }
