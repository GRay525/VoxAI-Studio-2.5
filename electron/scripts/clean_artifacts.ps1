$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronDir = Split-Path -Parent $scriptDir

$targets = @(
    (Join-Path $electronDir "dist-packager"),
    (Join-Path $electronDir "dist\win-unpacked"),
    (Join-Path $electronDir "dist\builder-debug.yml"),
    (Join-Path $electronDir "dist\latest.yml")
)

foreach ($target in $targets) {
    if (Test-Path $target) {
        Write-Host "[clean] Removing $target"
        Remove-Item -Path $target -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "[clean] Done."
