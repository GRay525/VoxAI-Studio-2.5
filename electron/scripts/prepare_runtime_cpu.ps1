param(
    [string]$PythonVersion = "3.10.11"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronDir = Split-Path -Parent $scriptDir
$repoRoot = Split-Path -Parent $electronDir
$runtimeDir = Join-Path $electronDir "runtime"
$cacheDir = Join-Path $electronDir ".cache"
$requirementsRuntime = Join-Path $repoRoot "requirements.runtime.txt"
$manifestPath = Join-Path $runtimeDir "runtime_manifest.json"

if (-not (Test-Path $requirementsRuntime)) {
    throw "requirements.runtime.txt not found: $requirementsRuntime"
}

New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

Write-Host "[runtime] Reset runtime directory..."
Get-ChildItem -Path $runtimeDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$embedZip = "python-$PythonVersion-embed-amd64.zip"
$embedUrl = "https://www.python.org/ftp/python/$PythonVersion/$embedZip"
$embedZipPath = Join-Path $cacheDir $embedZip
$getPipPath = Join-Path $cacheDir "get-pip.py"
$tempReqPath = Join-Path $cacheDir "requirements.runtime.no_torch.txt"

if (-not (Test-Path $embedZipPath)) {
    Write-Host "[runtime] Downloading embeddable Python $PythonVersion ..."
    Invoke-WebRequest -Uri $embedUrl -OutFile $embedZipPath
}

Write-Host "[runtime] Extracting embeddable Python..."
Expand-Archive -Path $embedZipPath -DestinationPath $runtimeDir -Force

$pthFile = Get-ChildItem -Path $runtimeDir -Filter "*._pth" | Select-Object -First 1
if ($null -eq $pthFile) {
    throw "Cannot find python _pth file in runtime directory."
}

$pthLines = Get-Content -Path $pthFile.FullName
$pthLines = $pthLines | ForEach-Object {
    if ($_ -match "^\s*#\s*import\s+site\s*$") { "import site" } else { $_ }
}
if (-not ($pthLines -contains "site-packages")) {
    $pthLines += "site-packages"
}
if (-not ($pthLines -contains "import site")) {
    $pthLines += "import site"
}
Set-Content -Path $pthFile.FullName -Value $pthLines -Encoding ASCII

if (-not (Test-Path $getPipPath)) {
    Write-Host "[runtime] Downloading get-pip.py ..."
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPipPath
}

$pythonExe = Join-Path $runtimeDir "python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "python.exe not found in runtime directory."
}

Write-Host "[runtime] Installing pip..."
& $pythonExe $getPipPath --no-warn-script-location

$sitePackages = Join-Path $runtimeDir "site-packages"
New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null

# Force CPU torch wheels to keep package size in control.
$reqLines = Get-Content -Path $requirementsRuntime | Where-Object {
    $_ -notmatch "^\s*torch\s*==" -and
    $_ -notmatch "^\s*torchaudio\s*=="
}
Set-Content -Path $tempReqPath -Value $reqLines -Encoding UTF8

Write-Host "[runtime] Installing non-torch runtime dependencies..."
& $pythonExe -m pip install --upgrade pip setuptools wheel --no-cache-dir
& $pythonExe -m pip install --no-cache-dir -r $tempReqPath --target $sitePackages

Write-Host "[runtime] Installing CPU-only torch dependencies..."
$torchSpec = (Get-Content -Path $requirementsRuntime | Where-Object { $_ -match "^\s*torch\s*==" } | Select-Object -First 1).Trim()
$torchaudioSpec = (Get-Content -Path $requirementsRuntime | Where-Object { $_ -match "^\s*torchaudio\s*==" } | Select-Object -First 1).Trim()
if (-not $torchSpec) { throw "torch pin not found in requirements.runtime.txt" }
if (-not $torchaudioSpec) { throw "torchaudio pin not found in requirements.runtime.txt" }
& $pythonExe -m pip install --no-cache-dir --index-url "https://download.pytorch.org/whl/cpu" $torchSpec $torchaudioSpec --target $sitePackages

$pythonVersionOutput = (& $pythonExe --version) -join ""
$pipFreeze = (& $pythonExe -m pip freeze) -join "`n"
$manifest = @{
    builtAt = (Get-Date).ToString("s")
    platform = "win32-x64"
    pythonVersion = $pythonVersionOutput
    requirementsSource = $requirementsRuntime
    torchVariant = "cpu"
    sitePackagesPath = $sitePackages
    pipFreeze = $pipFreeze
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

$runtimeSize = (Get-ChildItem -Path $runtimeDir -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("[runtime] Done. runtime size: {0} MB" -f [math]::Round($runtimeSize / 1MB, 2))
