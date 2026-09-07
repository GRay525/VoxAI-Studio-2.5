$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronDir = Split-Path -Parent $scriptDir
$distDir = Join-Path $electronDir "dist"
$runtimeDir = Join-Path $electronDir "runtime"

function Get-DirSizeMb([string]$path) {
    if (-not (Test-Path $path)) { return 0 }
    $bytes = (Get-ChildItem -Path $path -Recurse -File | Measure-Object Length -Sum).Sum
    return [math]::Round($bytes / 1MB, 2)
}

Write-Host "==== VoxAI Build Size Report ===="
Write-Host ("runtime: {0} MB" -f (Get-DirSizeMb $runtimeDir))
Write-Host ("dist:    {0} MB" -f (Get-DirSizeMb $distDir))

$asar = Join-Path $distDir "win-unpacked\resources\app.asar"
if (-not (Test-Path $asar)) {
    $asar = Join-Path $distDir "win-unpacked\resources\app.asar"
}
if (Test-Path $asar) {
    $asarMb = [math]::Round(((Get-Item $asar).Length / 1MB), 2)
    Write-Host ("app.asar: {0} MB" -f $asarMb)
}

$setupFiles = Get-ChildItem -Path $distDir -File -Filter "*Setup*.exe" -ErrorAction SilentlyContinue
foreach ($f in $setupFiles) {
    Write-Host ("setup: {0} => {1} MB" -f $f.Name, [math]::Round($f.Length / 1MB, 2))
}

$portableFiles = Get-ChildItem -Path $distDir -File -Filter "VoxAI-Studio-*.exe" -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -notlike "*Setup*"
}
foreach ($f in $portableFiles) {
    Write-Host ("portable: {0} => {1} MB" -f $f.Name, [math]::Round($f.Length / 1MB, 2))
}
