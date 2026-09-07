# VoxAI Studio 2.5

Windows app for voice cloning and text-to-speech. The model is [IndexTTS-2.5](https://github.com/index-tts/index-tts) from Bilibili; this repo is the desktop wrapper around it (Electron, a local Python server, some launch scripts).

It runs on your machine. Audio does not get sent anywhere.

This is not an official Bilibili / Index Team product. Do not drop IndexTTS-2 weights into this folder — the files and inference code are different.

## What it does

Give it a short reference clip and some text. It speaks that text in that voice.

Pick a synthesis language: Chinese, English, Japanese, Spanish, or Arabic. That setting is not a translator. If you pick the wrong one, it just sounds wrong.

Emotion usually comes from the same clip. You can also feed a second clip just for emotion, or push a few sliders. Output speed is adjustable (`0.5x`–`2.0x`). Half-precision on 2.5 is **BF16**, not FP16.

Closing the window hides it in the tray instead of quitting. The model stays loaded. A full quit unloads it.

## What you need

- Windows 10 or 11, 64-bit
- Python 3.10 or 3.11
- Node.js LTS
- An NVIDIA GPU unless you like waiting. About 6 GB of VRAM is the lowest I would call usable.

Weights live in `checkpoints/` and they are several GB. The first launch takes a while. Later launches are usually around a minute if the cache is already there.

This repo does **not** include:

- `checkpoints/` — download the model yourself
- `outputs/` — generated audio
- `prompts/` — your reference voices

## Run it

From a clone:

```bat
git clone https://github.com/GRay525/VoxAI-Studio-2.5.git
cd VoxAI-Studio-2.5
scripts\setup.cmd
scripts\download_models.cmd
start.cmd
```

Or PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
powershell -ExecutionPolicy Bypass -File scripts\download_models.ps1
cd electron
npm.cmd start
```

`download_models.cmd` pulls IndexTTS-2.5 weights (ModelScope by default). Hugging Face:

```powershell
powershell -File scripts\download_models.ps1 -Source huggingface
```

The first synthesis may still fetch w2v-bert, CAMPPlus, and BigVGAN into `checkpoints/hf_cache/`. If Hugging Face is slow:

```powershell
$env:HF_ENDPOINT = "https://hf-mirror.com"
```

Day to day, use `start.cmd`. It opens a CMD window on purpose so you can see backend logs.

## Voices

Only clone a voice you have permission to use. If you publish the audio, say that it was generated. The longer version is in [DISCLAIMER.md](DISCLAIMER.md).

Output quality follows the reference clip more than anything else. A few seconds of clean speech beats a long noisy recording. Listen to the result before you use it for anything that matters.

## How it is wired

```
Electron  →  FastAPI on 127.0.0.1:8000  →  IndexTTS-2.5
```

On quit it hits `/api/shutdown` so GPU memory actually gets released.

## Credit

The model and inference code belong to the [index-tts](https://github.com/index-tts/index-tts) team. Their license covers that part. This repo is the wrapper on top. See [LICENSE](LICENSE) and [LICENSE_ZH.txt](LICENSE_ZH.txt).
