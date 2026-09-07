$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

Write-Host "[setup] Project root: $root"

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "[setup] Installing uv..."
    python -m pip install -U uv
}

Write-Host "[setup] Syncing Python dependencies (this downloads PyTorch CUDA wheels)..."
uv lock
uv sync

$electronDir = Join-Path $root "electron"
Set-Location $electronDir
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required. Install Node.js LTS, then re-run this script."
}

Write-Host "[setup] Installing Electron dependencies..."
npm install

Set-Location $root
Write-Host "[setup] Done."
Write-Host "Next:"
Write-Host "  1. powershell -ExecutionPolicy Bypass -File scripts\download_models.ps1"
Write-Host "  2. cd electron; npm start"
