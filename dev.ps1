<#
.SYNOPSIS
  Start/stop the Clinic Management System backend (Django) + frontend (Vite) +
  background worker (Django-Q qcluster) together.

.USAGE
  .\dev.ps1 start       # start all three
  .\dev.ps1 stop        # stop all three
  .\dev.ps1 restart     # stop then start
  .\dev.ps1 status      # show whether each is running

  (or use the start.cmd / stop.cmd shims)

  Note: this runner does NOT set up the project. Create the venv + install deps first:
    cd Backend ; py -3.14 -m venv .venv ; .venv\Scripts\python.exe -m pip install -r requirements.txt
    cd Frontend ; npm install
#>
param(
  [ValidateSet('start', 'stop', 'restart', 'status')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$Root      = $PSScriptRoot
$Backend   = Join-Path $Root 'Backend'
$Frontend  = Join-Path $Root 'Frontend'
$RunDir    = Join-Path $Root '.run'
$PidFile   = Join-Path $RunDir 'pids.json'
$PyExe     = Join-Path $Backend '.venv\Scripts\python.exe'
$NodeMods  = Join-Path $Frontend 'node_modules'

function Test-Alive([int]$ProcessId) {
  if (-not $ProcessId) { return $false }
  return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Read-Pids {
  if (Test-Path $PidFile) {
    try { return Get-Content $PidFile -Raw | ConvertFrom-Json } catch { return $null }
  }
  return $null
}

function Stop-Tree([int]$ProcessId, [string]$Label) {
  if (Test-Alive $ProcessId) {
    & taskkill /PID $ProcessId /T /F 2>$null | Out-Null
    Write-Host "  stopped $Label (PID $ProcessId)" -ForegroundColor Yellow
  } else {
    Write-Host "  $Label was not running" -ForegroundColor DarkGray
  }
}

function Free-Port([int]$Port, [string]$Label) {
  # Belt-and-suspenders: kill whatever still listens on the port. Catches the
  # Vite/node process when it gets reparented away from the launched cmd.exe.
  $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  $owners = $conns.OwningProcess | Where-Object { $_ } | Select-Object -Unique
  foreach ($procId in $owners) {
    & taskkill /PID $procId /T /F 2>$null | Out-Null
    Write-Host "  freed port $Port ($Label, PID $procId)" -ForegroundColor Yellow
  }
}

function Do-Stop {
  Write-Host 'Stopping Clinic servers...' -ForegroundColor Cyan
  $pids = Read-Pids
  if ($null -ne $pids) {
    Stop-Tree ([int]$pids.backend) 'backend'
    Stop-Tree ([int]$pids.frontend) 'frontend'
    Stop-Tree ([int]$pids.worker) 'worker'
  }
  # Always free the well-known dev ports so nothing is left orphaned.
  Free-Port 8000 'backend'
  Free-Port 5173 'frontend'
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  Write-Host 'Stopped.' -ForegroundColor Green
}

function Do-Status {
  $pids = Read-Pids
  if ($null -eq $pids) { Write-Host 'Not running.' -ForegroundColor DarkGray; return }
  $b = if (Test-Alive ([int]$pids.backend)) { 'running' } else { 'stopped' }
  $f = if (Test-Alive ([int]$pids.frontend)) { 'running' } else { 'stopped' }
  $w = if (Test-Alive ([int]$pids.worker)) { 'running' } else { 'stopped' }
  Write-Host ("backend  (PID {0}): {1}" -f $pids.backend, $b)
  Write-Host ("frontend (PID {0}): {1}" -f $pids.frontend, $f)
  Write-Host ("worker   (PID {0}): {1}" -f $pids.worker, $w)
}

function Do-Start {
  # No auto-setup: fail fast with guidance if prerequisites are missing.
  if (-not (Test-Path $PyExe)) {
    throw "Backend virtualenv not found at $PyExe`nRun:  cd Backend ; py -3.14 -m venv .venv ; .venv\Scripts\python.exe -m pip install -r requirements.txt"
  }
  if (-not (Test-Path $NodeMods)) {
    throw "Frontend dependencies not installed.`nRun:  cd Frontend ; npm install"
  }

  $pids = Read-Pids
  if ($null -ne $pids -and ((Test-Alive ([int]$pids.backend)) -or (Test-Alive ([int]$pids.frontend)) -or (Test-Alive ([int]$pids.worker)))) {
    Write-Host 'Already running. Use "dev.ps1 restart" or "dev.ps1 stop" first.' -ForegroundColor Yellow
    Do-Status
    return
  }

  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

  Write-Host 'Starting backend (Django :8000)...' -ForegroundColor Cyan
  $backendProc = Start-Process -FilePath $PyExe `
    -ArgumentList 'manage.py', 'runserver', '127.0.0.1:8000' `
    -WorkingDirectory $Backend -PassThru `
    -RedirectStandardOutput (Join-Path $RunDir 'backend.log') `
    -RedirectStandardError  (Join-Path $RunDir 'backend.err')

  Write-Host 'Starting frontend (Vite :5173)...' -ForegroundColor Cyan
  $frontendProc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm run dev' `
    -WorkingDirectory $Frontend -PassThru `
    -RedirectStandardOutput (Join-Path $RunDir 'frontend.log') `
    -RedirectStandardError  (Join-Path $RunDir 'frontend.err')

  Write-Host 'Starting background worker (Django-Q qcluster)...' -ForegroundColor Cyan
  $workerProc = Start-Process -FilePath $PyExe `
    -ArgumentList 'manage.py', 'qcluster' `
    -WorkingDirectory $Backend -PassThru `
    -RedirectStandardOutput (Join-Path $RunDir 'worker.log') `
    -RedirectStandardError  (Join-Path $RunDir 'worker.err')

  @{
    backend  = $backendProc.Id
    frontend = $frontendProc.Id
    worker   = $workerProc.Id
    started  = (Get-Date).ToString('o')
  } | ConvertTo-Json | Set-Content -Path $PidFile -Encoding utf8

  Write-Host ''
  Write-Host 'Clinic is starting:' -ForegroundColor Green
  Write-Host '  App (frontend):  http://localhost:5173'
  Write-Host '  API (backend):   http://127.0.0.1:8000/api/'
  Write-Host '  Public kiosk:    http://localhost:5173/kiosk/1'
  Write-Host '  Logs:            .run\backend.log  .run\frontend.log  .run\worker.log'
  Write-Host '  Stop with:       .\stop.cmd   (or  .\dev.ps1 stop)'
}

switch ($Action) {
  'start'   { Do-Start }
  'stop'    { Do-Stop }
  'restart' { Do-Stop; Start-Sleep -Seconds 1; Do-Start }
  'status'  { Do-Status }
}
