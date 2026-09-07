# VoxAI Studio 2.5

Windows 桌面端语音合成应用。界面沿用 VoxAI Studio，引擎为官方 [IndexTTS-2.5](https://github.com/index-tts/index-tts)。

> **使用即表示你同意 [免责声明](DISCLAIMER.md) 以及 IndexTTS 的 [模型许可](LICENSE_ZH.txt)（[English](LICENSE)）。**  
> 本仓库不是 bilibili / Index Team 的官方产品。禁止用于未经授权的仿声、欺诈、深度伪造或任何违法用途。

## 功能

- 参考音频克隆音色
- 情感：从参考音频 / 独立情感音频 / 向量控制
- 合成语言：`ZH` / `EN` / `JA` / `ES` / `AR`（选错不会翻译，只影响读音）
- 语速：`0.5x`–`2.0x`
- 历史记录、语音库、托盘常驻（关窗口缩托盘不会卸载模型）

半精度在 2.5 对应 **BF16**，不是 FP16。

## 仓库里没有什么

下列内容体积大或属于用户数据，**不会**进 Git：

| 路径 | 说明 |
|------|------|
| `checkpoints/` | IndexTTS-2.5 权重，需自行下载 |
| `outputs/` | 生成的音频 |
| `prompts/` | 你导入的参考音色 |

不要把 IndexTTS 2.0 的权重拷进本目录，文件布局和推理代码都不兼容。

## 环境要求

- Windows 10 / 11
- NVIDIA GPU，建议 6 GB 以上显存
- Python 3.10 或 3.11
- Node.js LTS
- 带 CUDA 的 PyTorch（脚本会按 CUDA 12.8 安装）

## 第一次运行

在仓库根目录：

```bat
scripts\setup.cmd
scripts\download_models.cmd
start.cmd
```

或 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
powershell -ExecutionPolicy Bypass -File scripts\download_models.ps1
cd electron
npm.cmd start
```

- 日常启动：`start.cmd`（会打开 CMD 窗口，便于看后端日志）
- 权重默认从 ModelScope 下载；改用 Hugging Face：`scripts\download_models.ps1 -Source huggingface`
- 首次推理还会把 w2v-bert、CAMPPlus、BigVGAN 缓存到 `checkpoints/hf_cache/`。若 Hugging Face 较慢，可先设置 `$env:HF_ENDPOINT = "https://hf-mirror.com"`
- 模型加载通常约 1 分钟；首次或缓存未齐可能 2–5 分钟。完整退出后再开会重新加载；缩到托盘不会

## 工程结构

- `electron/`：桌面 UI、主进程、预加载脚本
- `api_server.py`：本地 FastAPI，调用 `indextts.infer_v2_5`
- `indextts/`：IndexTTS-2.5 推理代码
- `scripts/`：依赖安装与模型下载
- `DISCLAIMER.md`：使用限制与责任说明

## 许可证

- 本仓库中的 IndexTTS 模型与官方推理相关文件，遵循 **bilibili 模型使用许可协议**：见 [LICENSE](LICENSE)、[LICENSE_ZH.txt](LICENSE_ZH.txt)。
- 使用前请阅读 [DISCLAIMER.md](DISCLAIMER.md)。
- 月活超过 1 亿或年营收超过人民币 1 亿元的主体，须按官方协议另行申请许可。
