"""
VoxAI Studio Backend Server
===========================
REST API backend for VoxAI Studio (powered by IndexTTS-2.5).
Provides TTS synthesis, voice management, and emotion control endpoints.
"""

import os
# --- Thread Safety & Performance Optimization ---
# [Expert Recommendation] Set thread limits BEFORE importing torch/mkl
# to prevent DLL initialization deadlocks on Windows and resource contention.
os.environ['OMP_NUM_THREADS'] = '2'
os.environ['MKL_NUM_THREADS'] = '2'
os.environ['OPENBLAS_NUM_THREADS'] = '2'
os.environ['VECLIB_MAXIMUM_THREADS'] = '2'
os.environ['NUMEXPR_NUM_THREADS'] = '2'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

import gc
import sys
import time
import uuid
import signal
import asyncio
import json
import traceback
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

# Fix Windows console encoding for Unicode output
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add project root to path
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))
sys.path.insert(0, str(current_dir / "indextts"))

import warnings
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

import logging

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Note: Heavy modules (torch, transformers) are imported lazily in load_model_sync 
# to avoid blocking the API server startup.


class _SkipRoutineAccessLogs(logging.Filter):
    """Keep CMD readable: health/status polls happen often and are not useful noise."""

    def filter(self, record):
        try:
            msg = record.getMessage()
        except Exception:
            return True
        return "GET /health" not in msg and "GET /api/status" not in msg and "GET /api/synthesis/progress" not in msg


logging.getLogger("uvicorn.access").addFilter(_SkipRoutineAccessLogs())


# Global TTS instance
tts = None
MODEL_DIR = "./checkpoints"

# Precision mode: 'fp16' or 'fp32'
# Auto-detected based on VRAM: ≤8GB → FP16, >8GB → FP32
precision_mode = None  # Will be set on first load or via API

class SynthesisRequest(BaseModel):
    """Request body for TTS synthesis"""
    text: str = Field(..., description="Text to synthesize")
    voice_path: str = Field(..., description="Path to voice reference audio")
    emotion_mode: int = Field(0, description="0=from voice, 1=ref audio, 2=vector, 3=text")
    emotion_audio_path: Optional[str] = Field(None, description="Emotion reference audio path")
    emotion_weight: float = Field(0.65, ge=0.0, le=1.0, description="Emotion blending weight")
    emotion_vector: Optional[List[float]] = Field(None, description="8-dim emotion vector [happy,angry,sad,fear,disgust,melancholy,surprise,calm]")
    emotion_text: Optional[str] = Field(None, description="Text description for emotion")
    use_random: bool = Field(False, description="Enable random sampling for emotions")
    max_tokens_per_segment: int = Field(120, ge=20, le=300, description="Max tokens per segment")
    lang: str = Field("ZH", description="Synthesis language: ZH, EN, JA, ES, AR")
    duration_factor: float = Field(1.0, ge=0.5, le=2.0, description=">1.0 slower, <1.0 faster")
    # Generation parameters
    do_sample: bool = Field(True)
    temperature: float = Field(0.8, ge=0.1, le=2.0)
    top_p: float = Field(0.8, ge=0.0, le=1.0)
    top_k: int = Field(30, ge=0, le=100)
    repetition_penalty: float = Field(10.0, ge=0.1, le=20.0)

class VoiceInfo(BaseModel):
    """Voice file information"""
    name: str
    path: str
    duration: Optional[float] = None

class HistoryItem(BaseModel):
    """Generation history item"""
    filename: str
    text: str
    timestamp: str
    duration: float
    audio_url: str
    voice_name: Optional[str] = None

class SystemStatus(BaseModel):
    """System status information"""
    model_loaded: bool
    model_version: Optional[str]
    device: str
    cuda_available: bool
    gpu_name: Optional[str]
    loading: bool = False  # True if model is currently loading
    vram_app_gb: Optional[float] = None  # This process reserved CUDA memory
    vram_used_gb: Optional[float] = None  # Whole-GPU memory currently in use
    vram_total_gb: Optional[float] = None  # Total VRAM available
    load_error: Optional[str] = None  # Error message if loading failed
    load_progress: int = 0  # Loading progress 0-100
    precision_mode: Optional[str] = None  # 'fp16' or 'fp32'
    load_stage: Optional[str] = None  # Current loading stage description

# Model loading state
model_loading = False
model_load_error = None
model_load_progress = 0
model_load_stage = ""

# Server shutdown state
server_shutting_down = False
uvicorn_server = None  # Will be set when running with uvicorn

# Synthesis progress tracking
synthesis_in_progress = False
synthesis_progress = 0  # 0-100
synthesis_stage = ""  # e.g., "speech synthesis 1/3..."

def update_synthesis_progress(progress: float, stage: str):
    """Callback to update synthesis progress from inference engine."""
    global synthesis_progress, synthesis_stage
    synthesis_progress = int(progress * 100)
    synthesis_stage = stage
    print(f"    [{synthesis_progress}%] {stage}", flush=True)


def get_precision_mode() -> str:
    """
    Get the current precision mode, auto-detecting if not set.
    Rule: VRAM ≤8GB → FP16, VRAM >8GB → FP32
    """
    global precision_mode
    
    if precision_mode is not None:
        return precision_mode
    
    # Avoid blocking on import lock if another thread is importing
    if 'torch' not in sys.modules:
        return 'fp16'  # Default until torch is ready
    
    # Auto-detect based on VRAM
    try:
        import torch
        if torch.cuda.is_available():
            # Only do this check once to avoid overhead
            vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            if vram_gb <= 8:
                precision_mode = 'fp16'
                print(f"[*] Auto-detected VRAM: {vram_gb:.1f}GB → Using FP16 mode", flush=True)
            else:
                precision_mode = 'fp32'
                print(f"[*] Auto-detected VRAM: {vram_gb:.1f}GB → Using FP32 mode", flush=True)
        else:
            precision_mode = 'fp16'  # Default to FP16 for CPU/non-CUDA
            print("[*] No CUDA available → Using FP16 mode", flush=True)
    except Exception:
        precision_mode = 'fp16'
    
    return precision_mode or 'fp16'

def set_precision_mode(mode: str) -> bool:
    """Set precision mode manually. Returns True if model needs reload."""
    global precision_mode
    if mode not in ('fp16', 'fp32'):
        return False
    
    old_mode = precision_mode
    precision_mode = mode
    print(f"[*] Precision mode set to: {mode.upper()}", flush=True)
    
    # Return True if model is loaded and mode changed (needs reload)
    return tts is not None and old_mode != mode

def cleanup_resources():
    """Clean up GPU memory and resources before shutdown"""
    global tts
    print("[*] Cleaning up resources...", flush=True)
    
    if tts is not None:
        try:
            import torch
            del tts
            tts = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
            print("[OK] TTS model unloaded, VRAM released", flush=True)
        except Exception as e:
            print(f"[WARN] Error during cleanup: {e}", flush=True)
    else:
        print("[*] No model to unload", flush=True)

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    global server_shutting_down
    sig_name = signal.Signals(signum).name
    print(f"\n[*] Received {sig_name}, initiating graceful shutdown...", flush=True)
    
    if server_shutting_down:
        print("[*] Shutdown already in progress...", flush=True)
        return
    
    server_shutting_down = True
    cleanup_resources()
    print("[*] Graceful shutdown complete", flush=True)
    sys.exit(0)

# Register signal handlers (only in main process)
if __name__ == "__main__":
    if sys.platform != 'win32':
        # On Unix, register signals normally
        try:
            signal.signal(signal.SIGTERM, signal_handler)
            signal.signal(signal.SIGINT, signal_handler)
        except (ValueError, OSError):
            pass 
    
    # On Windows, signal handling is limited, 
    # but we can try to handle Ctrl+C
    try:
        signal.signal(signal.SIGINT, signal_handler)
    except:
        pass

def load_model_phase1():
    """
    PHASE 1: Critical Library Setup.
    MUST run on the Main Thread during lifespan.
    """
    global tts, model_loading, model_load_error, model_load_progress, model_load_stage
    model_loading = True
    model_load_error = None
    model_load_progress = 0
    model_load_stage = "Initializing..."
    
    print("[*] Starting Model Loading PHASE 1 (Critical Setup)...", flush=True)
    try:
        t0 = time.perf_counter()
        model_load_progress = 2
        model_load_stage = "Importing torch..."
        print("    [2%] Importing torch...", flush=True)
        import torch
        torch.set_num_threads(2)
        print(f"    >> Stage 1a (Torch) took {time.perf_counter() - t0:.2f}s", flush=True)

        t0 = time.perf_counter()
        model_load_progress = 5
        model_load_stage = "Importing transformers..."
        print("    [5%] Importing transformers...", flush=True)
        import transformers
        print(f"    >> Stage 1b (Transformers) took {time.perf_counter() - t0:.2f}s", flush=True)
        
        t0 = time.perf_counter()
        model_load_progress = 8
        model_load_stage = "Importing VoxAI engine..."
        print("    [8%] Importing VoxAI engine...", flush=True)
        from indextts.infer_v2_5 import IndexTTS2
        print(f"    >> Stage 1c (IndexTTS-2.5 Engine) took {time.perf_counter() - t0:.2f}s", flush=True)
        
        if torch.cuda.is_available():
            t0 = time.perf_counter()
            print("    [9%] Initializing CUDA context...", flush=True)
            _ = torch.zeros(1).cuda()
            torch.cuda.synchronize()
            print(f"    >> Stage 1d (CUDA Init) took {time.perf_counter() - t0:.2f}s", flush=True)

        model_load_progress = 10
        model_load_stage = "Loading configuration..."
        return True
    except Exception as e:
        import traceback
        model_load_error = str(e)
        model_load_stage = f"Phase 1 Error: {e}"
        print(f"[ERROR] Phase 1 Failed: {e}", flush=True)
        traceback.print_exc()
        model_loading = False # Reset on failure
        return False
        
def load_model_phase2():
    """
    PHASE 2: Heavy Weight Restoration.
    Can run in a background thread.
    """
    global tts, model_loading, model_load_error, model_load_progress, model_load_stage
    print("[*] Starting Model Loading PHASE 2 (Weights)...", flush=True)
    start_total = time.perf_counter()
    try:
        import torch
        from indextts.infer_v2_5 import IndexTTS2
        
        # Stage 2: Prepare config (15%)
        t0 = time.perf_counter()
        model_load_stage = "Loading configuration..."
        model_load_progress = 15
        
        model_dir = os.path.abspath(MODEL_DIR)
        cfg_path = os.path.join(model_dir, "config.yaml")
        
        # Stage 3: Initialize model (20-90%)
        t0 = time.perf_counter()
        model_load_stage = "Restoring model weights..."
        model_load_progress = 20
        print("    [20%] Restoring model weights...", flush=True)
        
        # IndexTTS-2.5 uses BF16 for the half-precision path (UI still calls it fp16)
        use_bf16 = get_precision_mode() != 'fp32'

        def report_weight_progress(progress, stage):
            global model_load_progress, model_load_stage
            model_load_progress = max(model_load_progress, int(progress))
            model_load_stage = stage
            print(f"    [{model_load_progress}%] {stage}", flush=True)
        
        tts = IndexTTS2(
            model_dir=model_dir,
            cfg_path=cfg_path,
            use_bf16=use_bf16,
            use_deepspeed=False,
            use_cuda_kernel=False,
            use_qwen_emo=True,
            on_progress=report_weight_progress,
        )
        print(f"    >> Stage 3 (Weights) took {time.perf_counter() - t0:.2f}s", flush=True)
        
        model_load_progress = 100
        model_load_stage = "Ready"
        print(f"[OK] Model ready in {time.perf_counter() - start_total:.2f}s", flush=True)
    except Exception as e:
        import traceback
        model_load_error = str(e)
        model_load_stage = f"Phase 2 Error: {e}"
        print(f"[ERROR] Phase 2 Failed: {e}", flush=True)
        traceback.print_exc()
    finally:
        model_loading = False
        
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI Lifespan Manager.
    - PHASE 1: Main Thread Library Setup.
    - PHASE 2: Background Model Loading.
    """
    print("[*] VoxAI Studio backend initializing...", flush=True)
    
    try:
        # 1. PHASE 1 (Main Thread)
        success = load_model_phase1()
        
        if success:
            # 2. PHASE 2 (Background Thread)
            import threading
            threading.Thread(target=load_model_phase2, daemon=True).start()
        
        yield
        
    finally:
        cleanup_resources()
    print("[*] VoxAI Studio backend stopped")
    
# Create FastAPI app
app = FastAPI(
    title="VoxAI Studio API",
    description="REST API for VoxAI Studio (powered by IndexTTS-2.5)",
    version="2.5.0",
    lifespan=lifespan
)

# Enable CORS for Electron renderer
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local Electron app
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure output directories exist
os.makedirs("outputs", exist_ok=True)
os.makedirs("prompts", exist_ok=True)

# Mount static files for serving generated audio
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")
app.mount("/prompts", StaticFiles(directory="prompts"), name="prompts")


def read_vram_stats():
    """Return (app_gb, device_used_gb, total_gb).

    App is this process's PyTorch reserved CUDA memory.
    Device used is the whole GPU (all processes), from CUDA free/total.
    """
    app_gb = None
    used_gb = None
    total_gb = None
    try:
        if 'torch' in sys.modules:
            import torch
            if torch.cuda.is_available():
                total_bytes = torch.cuda.get_device_properties(0).total_memory
                total_gb = round(total_bytes / (1024 ** 3), 2)
                app_gb = round(torch.cuda.memory_reserved(0) / (1024 ** 3), 2)
                free_b, total_b = torch.cuda.mem_get_info(0)
                used_gb = round((total_b - free_b) / (1024 ** 3), 2)
    except Exception:
        pass
    return app_gb, used_gb, total_gb


@app.get("/api/status", response_model=SystemStatus)
async def get_system_status():
    """Get system and model status"""
    gpu_name = None
    cuda_available = False
    vram_app = None
    vram_used = None
    vram_total = None
    
    try:
        if 'torch' in sys.modules:
            import torch
            if torch.cuda.is_available():
                cuda_available = True
                gpu_name = torch.cuda.get_device_name(0)
                vram_app, vram_used, vram_total = read_vram_stats()
    except Exception:
        pass
    
    # Get model version as string
    model_version = None
    if tts is not None:
        version = getattr(tts, 'model_version', None)
        if version is not None:
            model_version = str(version)
    
    return SystemStatus(
        model_loaded=tts is not None,
        model_version=model_version,
        device=str(tts.device) if tts else "none",
        cuda_available=cuda_available,
        gpu_name=gpu_name,
        loading=model_loading,
        vram_app_gb=vram_app,
        vram_used_gb=vram_used,
        vram_total_gb=vram_total,
        load_error=model_load_error,
        load_progress=model_load_progress,
        precision_mode=get_precision_mode(),
        load_stage=model_load_stage
    )


@app.post("/api/model/unload")
async def unload_model():
    """Unload the TTS model to release VRAM"""
    global tts, model_loading, model_load_error
    
    if model_loading:
        raise HTTPException(400, "Model is currently loading, cannot unload")
    
    if tts is None:
        return {"success": True, "message": "Model was not loaded"}
    
    try:
        print("[*] Unloading TTS model...", flush=True)
        import torch
        del tts
        tts = None
        
        # Clear CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        
        model_load_error = None
        print("[OK] Model unloaded, VRAM released", flush=True)
        return {"success": True, "message": "Model unloaded successfully"}
    except Exception as e:
        print(f"[ERROR] Failed to unload model: {e}", flush=True)
        raise HTTPException(500, f"Failed to unload model: {str(e)}")


@app.post("/api/model/load")
async def load_model():
    """Load or reload the TTS model"""
    global tts, model_loading, model_load_error
    
    if model_loading:
        raise HTTPException(400, "Model is already loading")
    
    if tts is not None:
        raise HTTPException(400, "Model is already loaded. Unload first.")
    
    def load_model_sync():
        if load_model_phase1():
            load_model_phase2()

    # Start loading in background thread
    import threading
    load_thread = threading.Thread(target=load_model_sync, daemon=True)
    load_thread.start()
    
    return {"success": True, "message": "Model loading started"}


class SettingsRequest(BaseModel):
    """Request body for settings update"""
    precision_mode: Optional[str] = Field(None, description="'fp16' or 'fp32'")


@app.get("/api/settings")
async def get_settings():
    """Get current settings including precision mode"""
    vram_total = None
    try:
        import torch
        if torch.cuda.is_available():
            vram_total = round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2)
    except ImportError:
        pass
    
    return {
        "precision_mode": get_precision_mode(),
        "vram_total_gb": vram_total,
        "recommended_mode": "fp16" if (vram_total or 0) <= 8 else "fp32"
    }


@app.post("/api/settings")
async def update_settings(request: SettingsRequest):
    """Update settings. If precision mode changes and model is loaded, requires reload."""
    needs_reload = False
    
    if request.precision_mode:
        if request.precision_mode not in ('fp16', 'fp32'):
            raise HTTPException(400, "precision_mode must be 'fp16' or 'fp32'")
        needs_reload = set_precision_mode(request.precision_mode)
    
    return {
        "success": True,
        "precision_mode": get_precision_mode(),
        "needs_reload": needs_reload
    }


@app.get("/api/voices", response_model=List[VoiceInfo])
async def list_voices():
    """List available voice prompts"""
    voices = []
    prompts_dir = Path("prompts")
    examples_dir = Path("examples")
    
    # Scan prompts directory
    if prompts_dir.exists():
        for f in prompts_dir.glob("*.wav"):
            voices.append(VoiceInfo(name=f.stem, path=str(f)))
    
    # Scan examples directory for voice files
    if examples_dir.exists():
        for f in examples_dir.glob("voice_*.wav"):
            voices.append(VoiceInfo(name=f.stem, path=str(f)))
    
    return voices


@app.post("/api/voices/upload")
async def upload_voice(file: UploadFile = File(...)):
    """Upload a new voice reference audio"""
    if not file.filename.lower().endswith(('.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac')):
        raise HTTPException(400, "Only audio files are supported (wav, mp3, flac, ogg, m4a, aac)")
    
    # Save to prompts directory
    save_path = Path("prompts") / f"{Path(file.filename).stem}_{int(time.time())}.wav"
    
    try:
        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
        
        return {"success": True, "path": str(save_path), "name": save_path.stem}
    except Exception as e:
        print(f"[ERROR] Failed to save uploaded file: {e}", flush=True)
        print(traceback.format_exc(), flush=True)
        raise HTTPException(500, "Failed to save uploaded file. See backend logs for details.")


@app.get("/api/emotions")
async def get_emotion_presets():
    """Get available emotion presets"""
    return {
        "modes": [
            {"id": 0, "name": "From Voice", "description": "Use emotion from voice reference"},
            {"id": 1, "name": "Reference Audio", "description": "Use separate emotion reference audio"},
            {"id": 2, "name": "Emotion Vector", "description": "Control with 8-dimension vector"},
            {"id": 3, "name": "Text Description", "description": "Generate emotion from text (experimental)"},
        ],
        "vector_labels": ["Happy", "Angry", "Sad", "Fear", "Disgust", "Melancholy", "Surprise", "Calm"],
        "presets": [
            {"name": "Neutral", "vector": [0, 0, 0, 0, 0, 0, 0, 1.0]},
            {"name": "Happy", "vector": [0.8, 0, 0, 0, 0, 0, 0.2, 0]},
            {"name": "Sad", "vector": [0, 0, 0.8, 0, 0, 0.2, 0, 0]},
            {"name": "Angry", "vector": [0, 0.9, 0, 0, 0.1, 0, 0, 0]},
            {"name": "Surprised", "vector": [0.2, 0, 0, 0.1, 0, 0, 0.7, 0]},
        ]
    }


@app.post("/api/synthesize")
async def synthesize_speech(request: SynthesisRequest):
    """Synthesize speech from text"""
    # Import torch locally
    import torch

    # Prevent concurrent synthesis (GPU can only handle one at a time)
    global synthesis_in_progress
    if synthesis_in_progress:
        raise HTTPException(503, "Synthesis is already in progress, please wait...")

    if tts is None:
        if model_loading:
            raise HTTPException(503, "TTS model is still loading, please wait...")
        elif model_load_error:
            raise HTTPException(503, f"TTS model failed to load: {model_load_error}")
        else:
            raise HTTPException(503, "TTS model not loaded")
    
    # Validate voice path
    if not os.path.exists(request.voice_path):
        raise HTTPException(400, f"Voice file not found: {request.voice_path}")

# Cleanup VRAM
    if request.emotion_mode in [1, 2, 3]:
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
            gc.collect()

    # Generate output path
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_filename = f"voice_{timestamp}_{uuid.uuid4().hex[:6]}.wav"
    output_path = os.path.join("outputs", output_filename)
    
    # Reset and track synthesis progress
    global synthesis_progress, synthesis_stage
    synthesis_in_progress = True
    synthesis_progress = 0
    synthesis_stage = "starting..."
    
    # Set up progress callback
    tts.gr_progress = lambda p, desc=None, **kwargs: update_synthesis_progress(p, desc or "")
    
    # Prepare emotion parameters
    emo_audio = None
    emo_vector = None
    use_emo_text = False
    emo_text = None
    
    if request.emotion_mode == 1 and request.emotion_audio_path:
        emo_audio = request.emotion_audio_path
    elif request.emotion_mode == 2 and request.emotion_vector:
        emo_vector = tts.normalize_emo_vec(request.emotion_vector, apply_bias=True)
    elif request.emotion_mode == 3:
        use_emo_text = True
        emo_text = request.emotion_text
    
    # Generation kwargs
    gen_kwargs = {
        "do_sample": request.do_sample,
        "temperature": request.temperature,
        "top_p": request.top_p,
        "top_k": request.top_k if request.top_k > 0 else None,
        "repetition_penalty": request.repetition_penalty,
    }
    
    # Define blocking inference function to run in thread
    def run_inference():
        lang = (request.lang or "ZH").strip().upper()
        if lang not in {"ZH", "EN", "JA", "ES", "AR", "ZHEN"}:
            lang = "ZH"
        return tts.infer(
            spk_audio_prompt=request.voice_path,
            text=request.text,
            lang=lang,
            output_path=output_path,
            emo_audio_prompt=emo_audio,
            emo_alpha=request.emotion_weight,
            emo_vector=emo_vector,
            use_emo_text=use_emo_text,
            emo_text=emo_text,
            use_random=request.use_random,
            max_text_tokens_per_segment=request.max_tokens_per_segment,
            duration_factor=request.duration_factor,
            verbose=False,
            **gen_kwargs
        )
    
    try:
        # Run synthesis in thread pool to not block event loop
        # This allows progress polling endpoint to respond during inference
        start_time = time.time()
        result = await asyncio.to_thread(run_inference)
        elapsed = time.time() - start_time
        
        if result and os.path.exists(output_path):
            # Clean up GPU memory after synthesis to prevent memory accumulation
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            gc.collect()
            
            # Save metadata for history
            metadata = {
                "filename": output_filename,
                "text": request.text,
                "timestamp": datetime.now().isoformat(),
                "duration": elapsed,
                "voice_name": Path(request.voice_path).stem
            }
            metadata_path = output_path.replace(".wav", ".json")
            try:
                with open(metadata_path, "w", encoding="utf-8") as f:
                    json.dump(metadata, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"[WARN] Failed to save metadata: {e}", flush=True)

            return {
                "success": True,
                "audio_path": output_path,
                "audio_url": f"/outputs/{output_filename}",
                "duration_seconds": elapsed,
            }
        else:
            raise HTTPException(500, "Synthesis failed - no output generated")
            
    except HTTPException:
        raise
    except Exception as e:
        # Also clean up on error
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()
        print(f"[ERROR] Synthesis failed: {e}", flush=True)
        print(traceback.format_exc(), flush=True)
        raise HTTPException(500, "Synthesis error. See backend logs for details.")
    finally:
        synthesis_in_progress = False
        synthesis_progress = 100
        synthesis_stage = "complete"


@app.get("/api/synthesis/progress")
async def get_synthesis_progress():
    """Get current synthesis progress (for polling during generation)"""
    return {
        "in_progress": synthesis_in_progress,
        "progress": synthesis_progress,
        "stage": synthesis_stage
    }


@app.get("/api/history", response_model=List[HistoryItem])
async def get_history():
    """Get generation history by scanning outputs directory"""
    history = []
    outputs_dir = Path("outputs")
    
    if not outputs_dir.exists():
        return []
    
    # Scan for metadata files
    for meta_file in sorted(outputs_dir.glob("*.json"), key=os.path.getmtime, reverse=True):
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                history.append(HistoryItem(
                    filename=data["filename"],
                    text=data["text"],
                    timestamp=data["timestamp"],
                    duration=data["duration"],
                    audio_url=f"/outputs/{data['filename']}",
                    voice_name=data.get("voice_name")
                ))
        except Exception as e:
            print(f"[WARN] Failed to read metadata {meta_file}: {e}", flush=True)
            
    return history


@app.delete("/api/history")
async def clear_history():
    """Delete all generated audio and metadata files"""
    outputs_dir = Path("outputs")
    if not outputs_dir.exists():
        return {"success": True, "count": 0}
    
    count = 0
    for f in outputs_dir.glob("voice_*.*"):
        try:
            os.remove(f)
            count += 1
        except Exception as e:
            print(f"[WARN] Failed to delete {f}: {e}", flush=True)
            
    return {"success": True, "deleted_count": count}


@app.get("/api/audio/{filename}")
async def get_audio(filename: str):
    """Serve generated audio file"""
    file_path = Path("outputs") / filename
    if not file_path.exists():
        raise HTTPException(404, "Audio file not found")
    return FileResponse(file_path, media_type="audio/wav")


@app.delete("/api/audio/{filename}")
async def delete_audio(filename: str):
    """Delete a generated audio file and its metadata"""
    file_path = Path("outputs") / filename
    meta_path = file_path.with_suffix(".json")
    
    success = False
    if file_path.exists():
        os.remove(file_path)
        success = True
    
    if meta_path.exists():
        os.remove(meta_path)
        success = True
        
    if success:
        return {"success": True}
        
    raise HTTPException(404, "File not found")


# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "ok", "model_ready": tts is not None}


@app.post("/api/shutdown")
async def shutdown_server():
    """
    Gracefully shutdown the server.
    This endpoint cleans up GPU memory before stopping.
    """
    global server_shutting_down
    
    if server_shutting_down:
        return {"success": True, "message": "Shutdown already in progress"}
    
    server_shutting_down = True
    print("[*] Shutdown requested via API", flush=True)
    
    # Clean up resources first
    cleanup_resources()
    
    # Schedule server stop
    async def stop_server():
        await asyncio.sleep(0.5)  # Give time for response to be sent
        print("[*] Stopping server...", flush=True)
        os._exit(0)  # Force exit after cleanup
    
    asyncio.create_task(stop_server())
    
    return {"success": True, "message": "Server shutting down gracefully"}


if __name__ == "__main__":
    import argparse
    import uvicorn
    
    parser = argparse.ArgumentParser(description="VoxAI Studio API Server")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    parser.add_argument("--model_dir", type=str, default="./checkpoints", help="Model directory")
    args = parser.parse_args()
    
    MODEL_DIR = args.model_dir
    
    print(f"[*] VoxAI Studio API Server starting on http://{args.host}:{args.port}")
    uvicorn.run(
        "api_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload
    )
