<#
.SYNOPSIS
    Install & run MOSS-TTS Local Server (CPU-friendly).

.DESCRIPTION
    Automated installation script for the TTS service.
    Creates a conda/venv environment, installs dependencies, and starts the server.

.PARAMETER Action
    install  — Create env and install dependencies (default)
    start    — Start the TTS server
    status   — Check if server is running
    stop     — Stop the TTS server

.EXAMPLE
    .\install.ps1 install
    .\install.ps1 start
#>

param(
    [ValidateSet("install", "start", "status", "stop")]
    [string]$Action = "install"
)

$ErrorActionPreference = "Stop"
$TTS_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$VENV_DIR = Join-Path $TTS_DIR ".venv"
$PID_FILE = Join-Path $TTS_DIR ".server.pid"
$PORT = 9880

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ── Install ──────────────────────────────────────────────────────────

function Install-TTSServer {
    Write-Step "Checking Python..."
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) {
        Write-Error "Python not found. Please install Python 3.10+ first."
        return
    }
    $pyVer = & python --version 2>&1
    Write-Host "  Found: $pyVer"

    Write-Step "Creating virtual environment at $VENV_DIR ..."
    if (-not (Test-Path $VENV_DIR)) {
        & python -m venv $VENV_DIR
    } else {
        Write-Host "  venv already exists, skipping creation."
    }

    # Activate venv
    $activateScript = Join-Path $VENV_DIR "Scripts\Activate.ps1"
    . $activateScript

    Write-Step "Upgrading pip..."
    & python -m pip install --upgrade pip --quiet

    Write-Step "Installing dependencies..."
    $reqFile = Join-Path $TTS_DIR "requirements.txt"
    & pip install -r $reqFile

    Write-Step "Verifying installation..."
    & python -c "import edge_tts; import fastapi; import uvicorn; print('All dependencies OK')"

    Write-Host "`n" -NoNewline
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  TTS Server installed successfully!" -ForegroundColor Green
    Write-Host "  Run: .\install.ps1 start" -ForegroundColor Green
    Write-Host "  API: http://127.0.0.1:$PORT" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
}

# ── Start ────────────────────────────────────────────────────────────

function Start-TTSServer {
    $activateScript = Join-Path $VENV_DIR "Scripts\Activate.ps1"
    if (-not (Test-Path $activateScript)) {
        Write-Error "venv not found. Run '.\install.ps1 install' first."
        return
    }

    # Check if already running
    if (Test-Path $PID_FILE) {
        $existingPid = Get-Content $PID_FILE -ErrorAction SilentlyContinue
        $proc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "TTS server already running (PID: $existingPid)" -ForegroundColor Yellow
            return
        }
    }

    Write-Step "Starting TTS server on port $PORT ..."
    . $activateScript

    Push-Location $TTS_DIR
    $process = Start-Process -FilePath python -ArgumentList "server.py" `
        -WorkingDirectory $TTS_DIR `
        -PassThru -WindowStyle Normal
    Pop-Location

    $process.Id | Out-File $PID_FILE -Encoding utf8
    Write-Host "TTS server started (PID: $($process.Id))" -ForegroundColor Green
    Write-Host "API: http://127.0.0.1:$PORT" -ForegroundColor Green
    Write-Host "Health: http://127.0.0.1:$PORT/health" -ForegroundColor Green
}

# ── Status ───────────────────────────────────────────────────────────

function Get-TTSServerStatus {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$PORT/health" -TimeoutSec 3
        Write-Host "TTS server is RUNNING" -ForegroundColor Green
        Write-Host "  Engine: $($resp.engine)"
        Write-Host "  Status: $($resp.status)"
    } catch {
        Write-Host "TTS server is NOT RUNNING" -ForegroundColor Red
    }
}

# ── Stop ─────────────────────────────────────────────────────────────

function Stop-TTSServer {
    if (Test-Path $PID_FILE) {
        $pid = Get-Content $PID_FILE -ErrorAction SilentlyContinue
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $pid -Force
            Write-Host "TTS server stopped (PID: $pid)" -ForegroundColor Yellow
        }
        Remove-Item $PID_FILE -ErrorAction SilentlyContinue
    } else {
        Write-Host "No PID file found." -ForegroundColor Yellow
    }
}

# ── Dispatch ─────────────────────────────────────────────────────────

switch ($Action) {
    "install" { Install-TTSServer }
    "start"   { Start-TTSServer }
    "status"  { Get-TTSServerStatus }
    "stop"    { Stop-TTSServer }
}
