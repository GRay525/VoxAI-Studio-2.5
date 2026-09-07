param(
    [ValidateSet("huggingface", "modelscope")]
    [string]$Source = "modelscope",
    [string]$LocalDir = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $LocalDir) {
    $LocalDir = Join-Path $root "checkpoints"
}

New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
Write-Host "[models] Downloading IndexTTS-2.5 into $LocalDir"

if ($Source -eq "modelscope") {
    python -m pip install -U modelscope
    modelscope download --model IndexTeam/IndexTTS-2.5 --local_dir $LocalDir
} else {
    python -m pip install -U "huggingface_hub[cli]"
    hf download IndexTeam/IndexTTS-2.5 --local-dir $LocalDir
}

$required = @(
    "config.yaml",
    "gpt.pth",
    "s2mel.pth",
    "codec.pth",
    "multilingual_zh_ja_yue_char_del.tiktoken"
)
$missing = @()
foreach ($name in $required) {
    if (-not (Test-Path (Join-Path $LocalDir $name))) {
        $missing += $name
    }
}
if ($missing.Count -gt 0) {
    throw "Download finished but missing: $($missing -join ', ')"
}

Write-Host "[models] IndexTTS-2.5 checkpoints are ready."
Write-Host "[models] Auxiliary models (w2v-bert, CAMPPlus, BigVGAN) download into checkpoints/hf_cache on first run."
