/**
 * VoxAI Studio - Main Application
 * ====================================
 * Application initialization, event handling, and UI logic
 */

// Application state
const state = {
    currentPanel: 'synthesis',
    voicePath: null,
    emotionAudioPath: null,
    emotionMode: 0,
    emotionVector: [0, 0, 0, 0, 0, 0, 0, 0],
    generatedAudioUrl: null,
    isGenerating: false,
    history: [],
    settings: {
        theme: 'dark',
        maxTokens: 120,
        temperature: 0.8
    },
    ttsLang: 'ZH',
    // Loading progress: backend jumps, UI eases toward them
    loadingSimulator: {
        rafId: null,
        currentProgress: 0,
        velocity: 0,
        targetProgress: 0,
        lastBackendProgress: 0,
        lastBackendAt: 0,
        lastTs: 0,
        lastPainted: -1,
        isActive: false,
        backendConnected: false,
        completing: false
    },
    // Language
    lang: 'en',
    isPackaged: false,
    statusStage: 'Initializing...',
    runtimeWizardVisible: false,
    runtimeChecked: false,
    lastRuntimeIssue: '',
    // Retry state for initial connection
    connectionRetries: 0,
    maxRetries: 60, // 60 attempts * 3s = 3 minutes total
    // Periodic status polling (for tray GPU/VRAM updates)
    statusPollIntervalId: null,
    genProgress: {
        rafId: null,
        current: 0,
        velocity: 0,
        target: 0,
        lastTs: 0,
        lastPainted: -1,
        stage: 'starting...',
        isActive: false,
        completing: false,
        startedAt: 0,
        frozenSec: null
    },
    lastGenSeconds: null
};

// Emotion presets
const emotionPresets = {
    neutral: [0, 0, 0, 0, 0, 0, 0, 100],
    happy: [80, 0, 0, 0, 0, 0, 20, 0],
    sad: [0, 0, 80, 0, 0, 20, 0, 0],
    angry: [0, 90, 0, 0, 10, 0, 0, 0],
    surprised: [20, 0, 0, 10, 0, 0, 70, 0]
};

/**
 * Translation helper for frontend strings
 */
function tr(key, fallback) {
    const lang = state.lang || 'en';
    if (window.translations &&
        window.translations[lang] &&
        Object.prototype.hasOwnProperty.call(window.translations[lang], key)) {
        return window.translations[lang][key];
    }
    return fallback !== undefined ? fallback : key;
}

// DOM Elements cache
let elements = {};

/**
 * Initialize the application
 */
async function init() {
    console.log('[VoxAI] Studio initializing...');

    // Cache DOM elements
    cacheElements();

    // Setup event listeners
    setupWindowControls();
    setupNavigation();
    setupVoiceUpload();
    setupTextInput();
    setupEmotionControls();
    setupTtsOptions();
    setupAudioPlayer();
    setupVoicePlayer();
    setupEmotionPlayer();
    setupSettings();
    setupLanguage();
    setupRuntimeWizard();

    // Initialize API (non-blocking)
    initializeAPI();

    // Fetch history from server (non-blocking)
    fetchHistory();

    // Load saved settings
    loadSettings();

    // Setup Electron listeners if available
    setupElectronListeners();
    probeRuntimeReadiness();

    console.log('[VoxAI] Studio ready');
}

/**
 * Cache frequently accessed DOM elements
 */
function cacheElements() {
    elements = {
        // Title bar
        btnMinimize: document.getElementById('btnMinimize'),
        btnMaximize: document.getElementById('btnMaximize'),
        btnClose: document.getElementById('btnClose'),

        // Navigation
        navItems: document.querySelectorAll('.nav-item'),
        panels: document.querySelectorAll('.panel'),

        // Status
        modelStatus: document.getElementById('modelStatus'),
        statusDot: document.querySelector('.status-dot'),
        statusText: document.querySelector('.status-text'),

        // Voice section
        voiceDropZone: document.getElementById('voiceDropZone'),
        voiceFileInput: document.getElementById('voiceFileInput'),
        voicePreview: document.getElementById('voicePreview'),
        voiceName: document.getElementById('voiceName'),
        voiceAudio: document.getElementById('voiceAudio'),
        btnRemoveVoice: document.getElementById('btnRemoveVoice'),
        voiceSelect: document.getElementById('voiceSelect'),

        // Text
        textInput: document.getElementById('textInput'),
        charCount: document.getElementById('charCount'),
        tokenCount: document.getElementById('tokenCount'),

        // Emotion
        emotionModes: document.querySelectorAll('input[name="emotionMode"]'),

        emotionFromVoiceSection: document.getElementById('emotionFromVoiceSection'),
        emotionAudioSection: document.getElementById('emotionAudioSection'),
        emotionVectorSection: document.getElementById('emotionVectorSection'),
        emotionWeightSection: document.getElementById('emotionWeightSection'),
        emotionDropZone: document.getElementById('emotionDropZone'),
        emotionFileInput: document.getElementById('emotionFileInput'),
        emotionPreview: document.getElementById('emotionPreview'),
        emotionName: document.getElementById('emotionName'),
        emotionAudio: document.getElementById('emotionAudio'),
        // Voice reference custom player
        voiceAudioPlayer: document.getElementById('voiceAudioPlayer'),
        voiceBtnPlay: document.getElementById('voiceBtnPlay'),
        voiceProgressBar: document.getElementById('voiceProgressBar'),
        voiceProgressFill: document.getElementById('voiceProgressFill'),
        voiceCurrentTime: document.getElementById('voiceCurrentTime'),
        voiceDuration: document.getElementById('voiceDuration'),
        // Emotion reference custom player
        emotionAudioPlayer: document.getElementById('emotionAudioPlayer'),
        emotionBtnPlay: document.getElementById('emotionBtnPlay'),
        emotionProgressBar: document.getElementById('emotionProgressBar'),
        emotionProgressFill: document.getElementById('emotionProgressFill'),
        emotionCurrentTime: document.getElementById('emotionCurrentTime'),
        emotionDuration: document.getElementById('emotionDuration'),
        btnRemoveEmotion: document.getElementById('btnRemoveEmotion'),
        emotionSliders: document.querySelectorAll('.emo-slider'),
        presetBtns: document.querySelectorAll('.preset-btn'),
        emotionWeight: document.getElementById('emotionWeight'),
        emotionWeightValue: document.getElementById('emotionWeightValue'),
        emotionSelect: document.getElementById('emotionSelect'),

        // Output
        waveformCanvas: document.getElementById('waveformCanvas'),
        waveformPlaceholder: document.getElementById('waveformPlaceholder'),
        audioPlayer: document.getElementById('audioPlayer'),
        outputAudio: document.getElementById('outputAudio'),
        btnPlay: document.getElementById('btnPlay'),
        progressBar: document.getElementById('progressBar'),
        progressFill: document.getElementById('progressFill'),
        currentTime: document.getElementById('currentTime'),
        duration: document.getElementById('duration'),
        generationProgress: document.getElementById('generationProgress'),
        progressText: document.getElementById('progressText'),
        genProgressPercent: document.getElementById('genProgressPercent'),
        genProgressBar: document.getElementById('genProgressBar'),
        genElapsedLive: document.getElementById('genElapsedLive'),
        genElapsed: document.getElementById('genElapsed'),

        // Actions
        btnGenerate: document.getElementById('btnGenerate'),
        btnExport: document.getElementById('btnExport'),

        // Settings
        themeSelect: document.getElementById('themeSelect'),
        maxTokens: document.getElementById('maxTokens'),
        temperature: document.getElementById('temperature'),
        ttsLangPills: document.getElementById('ttsLangPills'),
        durationFactor: document.getElementById('durationFactor'),
        durationFactorValue: document.getElementById('durationFactorValue'),
        apiStatus: document.getElementById('apiStatus'),

        // Toast
        toastContainer: document.getElementById('toastContainer'),

        // Voice library
        voiceGrid: document.getElementById('voiceGrid'),

        // Loading overlay
        loadingOverlay: document.getElementById('loadingOverlay'),
        loadingStatus: document.getElementById('loadingStatus'),
        loadingProgressBar: document.getElementById('loadingProgressBar'),
        loadingPercent: document.getElementById('loadingPercent'),

        // Model control
        btnUnloadModel: document.getElementById('btnUnloadModel'),
        btnLoadModel: document.getElementById('btnLoadModel'),
        modelStatusDesc: document.getElementById('modelStatusDesc'),
        modelStatusBadge: document.getElementById('modelStatusBadge'),
        vramApp: document.getElementById('vramApp'),
        vramDevice: document.getElementById('vramDevice'),
        vramTotal: document.getElementById('vramTotal'),
        precisionModeSelect: document.getElementById('precisionModeSelect'),
        precisionModeDesc: document.getElementById('precisionModeDesc'),
        btnClearHistory: document.getElementById('btnClearHistory'),
        runtimeMode: document.getElementById('runtimeMode')
        ,
        runtimeModal: document.getElementById('runtimeModal'),
        runtimeWizardMessage: document.getElementById('runtimeWizardMessage'),
        btnWizardPickModel: document.getElementById('btnWizardPickModel'),
        btnWizardRepairRuntime: document.getElementById('btnWizardRepairRuntime'),
        btnWizardSelfHeal: document.getElementById('btnWizardSelfHeal'),
        btnWizardDownloadModel: document.getElementById('btnWizardDownloadModel'),
        btnWizardDiagnostics: document.getElementById('btnWizardDiagnostics'),
        btnWizardClose: document.getElementById('btnWizardClose')
    };
}

/**
 * Setup window controls (minimize, maximize, close)
 */
function setupWindowControls() {
    if (window.electronAPI) {
        elements.btnMinimize?.addEventListener('click', () => window.electronAPI.minimize());
        elements.btnMaximize?.addEventListener('click', () => window.electronAPI.maximize());
        elements.btnClose?.addEventListener('click', () => window.electronAPI.close());
    } else {
        // Hide window controls in browser mode, but keep language button
        // document.querySelector('.title-bar-controls')?.classList.add('hidden');
        elements.btnMinimize?.classList.add('hidden');
        elements.btnMaximize?.classList.add('hidden');
        elements.btnClose?.classList.add('hidden');
    }
}

/**
 * Setup sidebar navigation
 */
function setupNavigation() {
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => {
            const panel = item.dataset.panel;
            switchPanel(panel);

            // Refresh history when switching to history panel
            if (panel === 'history') {
                fetchHistory();
            }
        });
    });
}

/**
 * Switch to a different panel
 */
function switchPanel(panelName) {
    state.currentPanel = panelName;

    // Update nav items
    elements.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.panel === panelName);
    });

    // Update panels
    elements.panels.forEach(panel => {
        panel.classList.toggle('active', panel.id === `panel${capitalize(panelName)}`);
    });
}

/**
 * Setup voice upload functionality
 */
function setupVoiceUpload() {
    const dropZone = elements.voiceDropZone;
    const fileInput = elements.voiceFileInput;

    // Click to upload
    dropZone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleVoiceFile(e.target.files[0]);
        }
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleVoiceFile(e.dataTransfer.files[0]);
        }
    });

    // Remove voice
    elements.btnRemoveVoice?.addEventListener('click', () => {
        state.voicePath = null;
        elements.voicePreview.classList.add('hidden');
        elements.voiceDropZone.classList.remove('hidden');
        elements.voiceAudio.src = '';
    });

    // Voice select change
    elements.voiceSelect?.addEventListener('change', (e) => {
        if (e.target.value) {
            state.voicePath = e.target.value;
            elements.voiceName.textContent = e.target.options[e.target.selectedIndex].text;
            elements.voiceAudio.src = window.api.getAudioUrl(e.target.value);
            elements.voicePreview.classList.remove('hidden');
            elements.voiceDropZone.classList.add('hidden');
        }
    });
}

/**
 * Handle voice file upload
 */
async function handleVoiceFile(file) {
    if (!file.type.startsWith('audio/')) {
        showToast(tr('toast.voice_invalid', 'Please upload an audio file'), 'error');
        return;
    }

    try {
        // Upload to server
        const result = await window.api.uploadVoice(file);
        state.voicePath = result.path;

        // Update UI
        elements.voiceName.textContent = result.name || file.name;
        elements.voiceAudio.src = URL.createObjectURL(file);
        elements.voicePreview.classList.remove('hidden');
        elements.voiceDropZone.classList.add('hidden');

        showToast(tr('toast.voice_uploaded', 'Voice uploaded successfully'), 'success');

        // Refresh voice list
        loadVoices();
    } catch (error) {
        showToast(`${tr('toast.voice_upload_failed_prefix', 'Upload failed')}: ${error.message}`, 'error');
    }
}

/**
 * Load available voices and emotion references from the backend
 */


/**
 * Setup text input
 */
function setupTextInput() {
    elements.textInput?.addEventListener('input', updateCharTokenDisplay);
    updateCharTokenDisplay();
}

function updateCharTokenDisplay() {
    const text = elements.textInput?.value || '';
    const charCount = text.length;
    const tokenCount = Math.ceil(charCount / 2);
    if (elements.charCount) {
        elements.charCount.textContent = tr('count.characters', '{n} characters').replace('{n}', String(charCount));
    }
    if (elements.tokenCount) {
        elements.tokenCount.textContent = tr('count.tokens', '~{n} tokens').replace('{n}', String(tokenCount));
    }
}

function clampDurationRaw(rawValue) {
    return Math.min(200, Math.max(50, Math.round(Number(rawValue) || 100)));
}

function parseDurationFactorInput(rawText) {
    const parsed = parseFloat(String(rawText ?? '').replace(/x/ig, '').replace(',', '.').trim());
    return Number.isFinite(parsed) ? parsed : NaN;
}

function applyDurationFactorRaw(rawValue, { syncInput = true } = {}) {
    const raw = clampDurationRaw(rawValue);
    if (elements.durationFactor) {
        elements.durationFactor.value = String(raw);
        const pct = ((raw - 50) / 150) * 100;
        elements.durationFactor.style.setProperty('--speed-pct', `${pct}%`);
    }
    if (syncInput && elements.durationFactorValue && document.activeElement !== elements.durationFactorValue) {
        elements.durationFactorValue.value = (raw / 100).toFixed(2);
    }
    localStorage.setItem('voxai_duration_factor', String(raw));
    return raw;
}

function commitDurationFactorInput() {
    const parsed = parseDurationFactorInput(elements.durationFactorValue?.value);
    const raw = Number.isFinite(parsed)
        ? clampDurationRaw(parsed * 100)
        : clampDurationRaw(elements.durationFactor?.value);
    applyDurationFactorRaw(raw);
    if (elements.durationFactorValue) {
        elements.durationFactorValue.value = (raw / 100).toFixed(2);
    }
}

function updateDurationFactorDisplay(rawValue) {
    applyDurationFactorRaw(rawValue);
}

/**
 * Setup IndexTTS-2.5 language pills and speaking-speed slider
 */
function setupTtsOptions() {
    const savedLang = (localStorage.getItem('voxai_tts_lang') || 'ZH').toUpperCase();
    const allowed = ['ZH', 'EN', 'JA', 'ES', 'AR'];
    setTtsLang(allowed.includes(savedLang) ? savedLang : 'ZH');

    elements.ttsLangPills?.querySelectorAll('[data-lang]').forEach((btn) => {
        btn.addEventListener('click', () => setTtsLang(btn.dataset.lang));
    });

    const savedSpeed = parseInt(localStorage.getItem('voxai_duration_factor'), 10);
    if (elements.durationFactor) {
        const raw = Number.isFinite(savedSpeed) ? savedSpeed : parseInt(elements.durationFactor.value, 10);
        applyDurationFactorRaw(raw);
    }

    elements.durationFactorValue?.addEventListener('focus', () => {
        elements.durationFactorValue.select();
    });
    elements.durationFactorValue?.addEventListener('input', () => {
        const parsed = parseDurationFactorInput(elements.durationFactorValue.value);
        if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 2) {
            return;
        }
        applyDurationFactorRaw(parsed * 100, { syncInput: false });
    });
    elements.durationFactorValue?.addEventListener('change', commitDurationFactorInput);
    elements.durationFactorValue?.addEventListener('blur', commitDurationFactorInput);
    elements.durationFactorValue?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitDurationFactorInput();
            elements.durationFactorValue.blur();
        } else if (e.key === 'Escape') {
            const raw = clampDurationRaw(elements.durationFactor?.value);
            if (elements.durationFactorValue) {
                elements.durationFactorValue.value = (raw / 100).toFixed(2);
            }
            applyDurationFactorRaw(raw);
            elements.durationFactorValue.blur();
        }
    });
}

function setTtsLang(lang) {
    const next = (lang || 'ZH').toUpperCase();
    state.ttsLang = next;
    localStorage.setItem('voxai_tts_lang', next);
    elements.ttsLangPills?.querySelectorAll('[data-lang]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.lang === next);
    });
}

/**
 * Setup emotion controls
 */
function setupEmotionControls() {
    // Emotion mode radio buttons
    elements.emotionModes.forEach(radio => {
        radio.addEventListener('change', () => {
            state.emotionMode = parseInt(radio.value);
            updateEmotionUI();
        });
    });

    // Emotion library select
    if (elements.emotionSelect) {
        elements.emotionSelect.addEventListener('change', async (e) => {
            const voicePath = e.target.value;
            if (!voicePath) return;

            try {
                // Set the emotion audio path to the selected library file
                state.emotionAudioPath = voicePath;

                // Update UI to show selected emotion reference
                elements.emotionName.textContent = e.target.options[e.target.selectedIndex].text;
                elements.emotionAudio.src = window.api.getAudioUrl(voicePath);
                elements.emotionPreview.classList.remove('hidden');
                elements.emotionDropZone.classList.add('hidden');

                // Show localized text
                const msg = state.lang === 'zh' ? '已选择情感参考音频' : 'Emotion reference selected';
                showToast(msg, 'info');

            } catch (error) {
                console.error('Error selecting emotion voice:', error);
                const msg = state.lang === 'zh' ? '选择失败' : 'Failed to select voice';
                showToast(msg, 'error');
            }
        });
    }

    // Emotion sliders
    elements.emotionSliders.forEach(slider => {
        slider.addEventListener('input', () => {
            const idx = parseInt(slider.dataset.emo);
            state.emotionVector[idx] = parseInt(slider.value);
            slider.nextElementSibling.textContent = slider.value;
        });
    });

    // Preset buttons
    elements.presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            if (emotionPresets[preset]) {
                applyEmotionPreset(emotionPresets[preset]);
            }
        });
    });

    // Emotion weight slider
    elements.emotionWeight?.addEventListener('input', () => {
        const value = elements.emotionWeight.value / 100;
        elements.emotionWeightValue.textContent = value.toFixed(2);
    });
    elements.durationFactor?.addEventListener('input', () => {
        updateDurationFactorDisplay(elements.durationFactor.value);
        localStorage.setItem('voxai_duration_factor', String(elements.durationFactor.value));
    });

    // Emotion audio upload
    const emotionDropZone = elements.emotionDropZone;
    const emotionFileInput = elements.emotionFileInput;

    emotionDropZone?.addEventListener('click', () => emotionFileInput.click());
    emotionFileInput?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleEmotionFile(e.target.files[0]);
        }
    });

    // Drag and drop for emotion reference
    if (emotionDropZone) {
        emotionDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            emotionDropZone.classList.add('dragover');
        });

        emotionDropZone.addEventListener('dragleave', () => {
            emotionDropZone.classList.remove('dragover');
        });

        emotionDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            emotionDropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleEmotionFile(e.dataTransfer.files[0]);
            }
        });
    }

    // Remove emotion reference
    elements.btnRemoveEmotion?.addEventListener('click', () => {
        state.emotionAudioPath = null;
        elements.emotionPreview.classList.add('hidden');
        elements.emotionDropZone.classList.remove('hidden');
        elements.emotionAudio.src = '';
        if (elements.emotionSelect) elements.emotionSelect.value = "";
    });

    // Initial UI update
    updateEmotionUI();
}

/**
 * Update emotion UI based on mode
 */
function updateEmotionUI() {
    elements.emotionFromVoiceSection?.classList.toggle('hidden', state.emotionMode !== 0);
    elements.emotionAudioSection?.classList.toggle('hidden', state.emotionMode !== 1);
    elements.emotionVectorSection?.classList.toggle('hidden', state.emotionMode !== 2);
    elements.emotionWeightSection?.classList.toggle('hidden', state.emotionMode === 0);
}

/**
 * Apply emotion preset
 */
function applyEmotionPreset(values) {
    state.emotionVector = [...values];
    elements.emotionSliders.forEach((slider, idx) => {
        slider.value = values[idx];
        slider.nextElementSibling.textContent = values[idx];
    });
}

/**
 * Handle emotion audio file
 */
async function handleEmotionFile(file) {
    try {
        const result = await window.api.uploadVoice(file);
        state.emotionAudioPath = result.path;

        // Update UI
        elements.emotionName.textContent = result.name || file.name;
        elements.emotionAudio.src = URL.createObjectURL(file);
        elements.emotionPreview.classList.remove('hidden');
        elements.emotionDropZone.classList.add('hidden');

        showToast(tr('toast.emotion_uploaded', 'Emotion audio uploaded'), 'success');
    } catch (error) {
        showToast(`${tr('toast.emotion_upload_failed_prefix', 'Upload failed')}: ${error.message}`, 'error');
    }
}

/**
 * Setup audio player
 */
function setupAudioPlayer() {
    const audio = elements.outputAudio;

    // Play/Pause button
    elements.btnPlay?.addEventListener('click', () => {
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    });

    // Audio events
    audio?.addEventListener('play', () => {
        elements.btnPlay.querySelector('.icon-play').classList.add('hidden');
        elements.btnPlay.querySelector('.icon-pause').classList.remove('hidden');
    });

    audio?.addEventListener('pause', () => {
        elements.btnPlay.querySelector('.icon-play').classList.remove('hidden');
        elements.btnPlay.querySelector('.icon-pause').classList.add('hidden');
    });

    audio?.addEventListener('timeupdate', () => {
        const progress = (audio.currentTime / audio.duration) * 100;
        elements.progressFill.style.width = `${progress}%`;
        elements.currentTime.textContent = window.audioManager.formatTime(audio.currentTime);
    });

    audio?.addEventListener('loadedmetadata', () => {
        elements.duration.textContent = window.audioManager.formatTime(audio.duration);
    });

    // Progress bar seek
    elements.progressBar?.addEventListener('click', (e) => {
        const rect = elements.progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        audio.currentTime = percent * audio.duration;
    });

    // Generate button
    elements.btnGenerate?.addEventListener('click', generateSpeech);

    // Export button
    elements.btnExport?.addEventListener('click', exportAudio);
}

/**
 * Reusable mini audio player setup (shared by voice, emotion, history players)
 */
function setupMiniPlayer(audioEl, btnPlay, progressFill, currentTimeEl, durationEl, progressBar) {
    if (!audioEl || !btnPlay) return;

    btnPlay.addEventListener('click', () => {
        if (!audioEl.src) return;
        if (audioEl.paused) {
            audioEl.play();
        } else {
            audioEl.pause();
        }
    });

    audioEl.addEventListener('play', () => {
        btnPlay.querySelector('.icon-play')?.classList.add('hidden');
        btnPlay.querySelector('.icon-pause')?.classList.remove('hidden');
    });

    audioEl.addEventListener('pause', () => {
        btnPlay.querySelector('.icon-play')?.classList.remove('hidden');
        btnPlay.querySelector('.icon-pause')?.classList.add('hidden');
    });

    audioEl.addEventListener('timeupdate', () => {
        const progress = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
        if (progressFill) progressFill.style.width = `${progress}%`;
        if (currentTimeEl) currentTimeEl.textContent = window.audioManager.formatTime(audioEl.currentTime);
    });

    audioEl.addEventListener('loadedmetadata', () => {
        if (durationEl) durationEl.textContent = window.audioManager.formatTime(audioEl.duration);
    });

    if (progressBar) {
        progressBar.addEventListener('click', (e) => {
            if (!audioEl.duration) return;
            const rect = progressBar.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            audioEl.currentTime = percent * audioEl.duration;
        });
    }
}

/**
 * Setup voice reference audio player
 */
function setupVoicePlayer() {
    setupMiniPlayer(
        elements.voiceAudio,
        elements.voiceBtnPlay,
        elements.voiceProgressFill,
        elements.voiceCurrentTime,
        elements.voiceDuration,
        elements.voiceProgressBar
    );
}

/**
 * Setup emotion reference audio player
 */
function setupEmotionPlayer() {
    setupMiniPlayer(
        elements.emotionAudio,
        elements.emotionBtnPlay,
        elements.emotionProgressFill,
        elements.emotionCurrentTime,
        elements.emotionDuration,
        elements.emotionProgressBar
    );
}

// (legacy history inline player setup removed; new per-item player is created dynamically in playHistoryItem)

function formatGenElapsed(seconds, done) {
    const t = Math.max(0, Number(seconds) || 0);
    const value = `${t.toFixed(1)}${state.lang === 'zh' ? ' 秒' : 's'}`;
    const key = done ? 'gen.elapsed_done' : 'gen.elapsed';
    const fallback = done ? 'Generated in {t}' : 'Elapsed {t}';
    return tr(key, fallback).replace('{t}', value);
}

function showGenElapsedDone(seconds) {
    state.lastGenSeconds = seconds;
    if (elements.genElapsed) {
        elements.genElapsed.textContent = formatGenElapsed(seconds, true);
        elements.genElapsed.classList.remove('hidden');
    }
}

/**
 * Translate backend synthesis stage strings for the output card.
 */
function translateSynthStage(stage) {
    const raw = String(stage || '').trim();
    if (!raw) return tr('synth.starting', 'Starting synthesis...');
    const speech = raw.match(/speech synthesis\s+(\d+)\s*\/\s*(\d+)/i);
    if (speech) {
        return tr('synth.speech', 'Synthesizing speech {n}/{total}...')
            .replace('{n}', speech[1])
            .replace('{total}', speech[2]);
    }
    const map = {
        'starting...': 'synth.starting',
        'Starting synthesis...': 'synth.starting',
        'starting inference...': 'synth.inference',
        'text processing...': 'synth.text',
        'saving audio...': 'synth.saving',
        'complete': 'synth.complete',
        'processing...': 'synth.processing'
    };
    const key = map[raw];
    return key ? tr(key, raw) : raw;
}

function paintGenProgress(progress, stage) {
    const g = state.genProgress;
    const clamped = Math.max(0, Math.min(100, progress));
    const painted = Math.round(clamped * 10);
    if (elements.genProgressBar) {
        elements.genProgressBar.style.width = `${clamped}%`;
    }
    if (elements.genProgressPercent && g.lastPainted !== painted) {
        g.lastPainted = painted;
        elements.genProgressPercent.textContent = clamped >= 99.95 ? '100%' : `${clamped.toFixed(1)}%`;
    }
    if (stage && elements.progressText) {
        g.stage = stage;
        elements.progressText.textContent = translateSynthStage(stage);
    }
}

function tickGenProgress(now) {
    const g = state.genProgress;
    if (!g.isActive) return;
    if (!g.lastTs) g.lastTs = now;
    const dt = Math.min(0.05, Math.max(0.008, (now - g.lastTs) / 1000));
    g.lastTs = now;

    let target = g.completing ? 100 : Math.min(g.target, 99.2);
    if (g.current > target) {
        g.current = target;
        g.velocity = 0;
    }
    const gap = target - g.current;
    if (gap > 0.001) {
        const omega = g.completing ? 7.2 : (gap > 12 ? 6.0 : 4.2);
        g.velocity += (gap * omega * omega - 2 * 1.08 * omega * g.velocity) * dt;
        const maxSpeed = g.completing ? 70 : (gap > 12 ? 38 : 26);
        if (g.velocity > maxSpeed) g.velocity = maxSpeed;
        if (g.velocity < 0) g.velocity = 0;
        g.current += g.velocity * dt;
        if (g.current > target) {
            g.current = target;
            g.velocity *= 0.25;
        }
    } else {
        g.current = target;
        g.velocity = 0;
    }
    paintGenProgress(g.current);
    if (elements.genElapsedLive && g.startedAt && g.frozenSec == null) {
        const elapsed = (performance.now() - g.startedAt) / 1000;
        elements.genElapsedLive.textContent = formatGenElapsed(elapsed, false);
    }
    g.rafId = requestAnimationFrame(tickGenProgress);
}

function startGenProgress(stage) {
    const g = state.genProgress;
    if (g.rafId) cancelAnimationFrame(g.rafId);
    g.isActive = true;
    g.completing = false;
    g.current = 0;
    g.target = 0;
    g.velocity = 0;
    g.lastTs = 0;
    g.lastPainted = -1;
    g.stage = stage || 'starting...';
    g.startedAt = performance.now();
    g.frozenSec = null;
    paintGenProgress(0, g.stage);
    g.rafId = requestAnimationFrame(tickGenProgress);
}

function syncGenProgress(percent, stage) {
    const g = state.genProgress;
    const next = Number(percent) || 0;
    if (next > g.target + 0.05 && g.velocity < 4) g.velocity = 4;
    g.target = next;
    if (stage) paintGenProgress(g.current, stage);
}

function freezeGenElapsed() {
    const g = state.genProgress;
    if (g.frozenSec != null) return g.frozenSec;
    const elapsed = g.startedAt
        ? (performance.now() - g.startedAt) / 1000
        : 0;
    g.frozenSec = Math.max(0, elapsed);
    if (elements.genElapsedLive) {
        elements.genElapsedLive.textContent = formatGenElapsed(g.frozenSec, false);
    }
    return g.frozenSec;
}

function stopGenProgress() {
    const g = state.genProgress;
    if (g.rafId) {
        cancelAnimationFrame(g.rafId);
        g.rafId = null;
    }
    g.isActive = false;
    g.completing = false;
    g.velocity = 0;
}

function finishGenProgress() {
    const g = state.genProgress;
    if (!g.isActive) startGenProgress('complete');
    g.completing = true;
    g.target = 100;
    paintGenProgress(g.current, 'complete');
    return new Promise((resolve) => {
        const started = performance.now();
        const wait = () => {
            if (!g.isActive || g.current >= 99.5 || performance.now() - started > 900) {
                paintGenProgress(100, 'complete');
                stopGenProgress();
                resolve();
                return;
            }
            requestAnimationFrame(wait);
        };
        requestAnimationFrame(wait);
    });
}

function clearOutputWaveform() {
    const canvas = elements.waveformCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function renderOutputWaveform(url) {
    const canvas = elements.waveformCanvas;
    if (elements.waveformPlaceholder) {
        elements.waveformPlaceholder.classList.add('hidden');
    }
    if (!url || !canvas || !window.audioManager) return;
    try {
        const buffer = await window.audioManager.loadAudioUrl(url);
        requestAnimationFrame(() => {
            window.audioManager.drawWaveform(canvas, buffer);
        });
    } catch (error) {
        console.warn('Waveform render skipped:', error);
    }
}

/**
 * Generate speech
 */
async function generateSpeech() {
    // Validate inputs
    if (!state.voicePath) {
        showToast(tr('toast.no_voice', 'Please select a voice reference'), 'warning');
        return;
    }

    const text = elements.textInput.value.trim();
    if (!text) {
        showToast(tr('toast.no_text', 'Please enter text to synthesize'), 'warning');
        return;
    }

    // Update UI
    state.isGenerating = true;
    elements.btnGenerate.disabled = true;
    elements.generationProgress.classList.remove('hidden');
    elements.audioPlayer.classList.add('hidden');
    clearOutputWaveform();
    elements.waveformPlaceholder?.classList.remove('hidden');
    if (elements.genElapsed) elements.genElapsed.classList.add('hidden');
    startGenProgress('starting...');

    let progressInterval = null;
    const pollProgress = async () => {
        try {
            const progress = await window.api.getSynthesisProgress();
            if (progress.in_progress) {
                syncGenProgress(progress.progress || 0, progress.stage || 'processing...');
            }
        } catch (e) {
            // Ignore polling errors
        }
    };
    progressInterval = setInterval(pollProgress, 800);

    try {
        // Prepare request
        const durationRaw = parseInt(elements.durationFactor?.value, 10);
        const durationFactor = Number.isFinite(durationRaw) ? durationRaw / 100 : 1.0;
        const params = {
            text: text,
            voice_path: state.voicePath,
            emotion_mode: state.emotionMode,
            emotion_weight: elements.emotionWeight.value / 100,
            max_tokens_per_segment: parseInt(elements.maxTokens?.value) || 120,
            temperature: parseFloat(elements.temperature?.value) || 0.8,
            lang: state.ttsLang || 'ZH',
            duration_factor: Math.min(2.0, Math.max(0.5, durationFactor))
        };

        if (state.emotionMode === 1 && state.emotionAudioPath) {
            params.emotion_audio_path = state.emotionAudioPath;
        } else if (state.emotionMode === 2) {
            params.emotion_vector = state.emotionVector.map(v => v / 100);
        }

        // Call API
        const result = await window.api.synthesize(params);
        const elapsedSec = freezeGenElapsed();

        if (result.success) {
            state.generatedAudioUrl = window.api.getAudioUrl(result.audio_url);

            // Update audio player
            elements.outputAudio.src = state.generatedAudioUrl;
            elements.audioPlayer.classList.remove('hidden');
            elements.btnExport.disabled = false;
            elements.waveformPlaceholder.classList.add('hidden');
            await renderOutputWaveform(state.generatedAudioUrl);

            // Add to history
            addToHistory(text, state.generatedAudioUrl);

            showGenElapsedDone(elapsedSec);
            showToast(tr('toast.generated_success', 'Speech generated successfully!'), 'success');
        }
    } catch (error) {
        freezeGenElapsed();
        showToast(`${tr('toast.model_load_failed_prefix', 'Generation failed')}: ${error.message}`, 'error');
        clearOutputWaveform();
        elements.waveformPlaceholder.classList.remove('hidden');
    } finally {
        // Stop progress polling
        if (progressInterval) {
            clearInterval(progressInterval);
        }
        await finishGenProgress();
        state.isGenerating = false;
        elements.btnGenerate.disabled = false;
        elements.generationProgress.classList.add('hidden');
    }
}

/**
 * Export generated audio
 */
async function exportAudio() {
    if (!state.generatedAudioUrl) {
        showToast(tr('toast.no_audio', 'No audio generated yet'), 'warning');
        return;
    }

    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const filename = `voxai_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.wav`;

    if (window.electronAPI && typeof window.electronAPI.saveAudio === 'function') {
        try {
            const result = await window.electronAPI.saveAudio({
                url: state.generatedAudioUrl,
                filename
            });
            if (result?.canceled) {
                return;
            }
            if (result?.success) {
                const name = result.path ? result.path.split(/[/\\]/).pop() : filename;
                showToast(tr('toast.audio_saved', 'Saved {name}').replace('{name}', name), 'success');
                return;
            }
            showToast(
                tr('toast.audio_save_failed', 'Save failed: {err}').replace('{err}', result?.message || ''),
                'error'
            );
        } catch (error) {
            showToast(
                tr('toast.audio_save_failed', 'Save failed: {err}').replace('{err}', error.message || ''),
                'error'
            );
        }
        return;
    }

    const link = document.createElement('a');
    link.href = state.generatedAudioUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Fetch generation history from server
 */
async function fetchHistory() {
    try {
        const history = await window.api.getHistory();
        state.history = history;
        updateHistoryUI();
    } catch (error) {
        console.error('Failed to fetch history:', error);
    }
}

/**
 * Add to generation history (refreshes from server)
 */
async function addToHistory() {
    // We already saved on server, just pull updated list
    await fetchHistory();
}

/**
 * Update history panel UI
 */
function updateHistoryUI() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    if (state.history.length === 0) {
        const title = tr('history.empty_title', 'No generation history');
        const hint = tr('history.empty_hint', 'Generated audio will appear here');
        historyList.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
                <p>${title}</p>
                <p class="hint">${hint}</p>
            </div>
        `;
        return;
    }

    historyList.innerHTML = state.history.map((item, i) => {
        const date = new Date(item.timestamp);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

        return `
            <div class="history-item" data-index="${i}">
                <button class="btn-icon" onclick="playHistoryItem(${i})" title="Play">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                <div class="history-info">
                    <span class="history-text" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</span>
                    <div class="history-meta">
                        <span class="history-time">${dateStr} ${timeStr}</span>
                        <span class="history-duration">${item.duration.toFixed(1)}s</span>
                        <span class="history-voice">${item.voice_name || ''}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 获取（懒加载）历史记录内联播放器
 * 该播放器会被动态插入到当前正在播放的历史卡片下面
 */
let historyPlayerContainer = null;
let historyPlayerAudio = null;

function getHistoryPlayer() {
    if (historyPlayerContainer && historyPlayerAudio) {
        return { container: historyPlayerContainer, audio: historyPlayerAudio };
    }

    // 创建容器
    historyPlayerContainer = document.createElement('div');
    historyPlayerContainer.className = 'history-inline-player';

    // 使用与主播放器一致的紧凑样式
    historyPlayerContainer.innerHTML = `
        <div class="audio-player small">
            <button class="play-btn">
                <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <svg class="icon-pause hidden" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                </svg>
            </button>
            <span class="time-display current">0:00</span>
            <div class="progress-bar">
                <div class="progress-fill"></div>
            </div>
            <span class="time-display duration">0:00</span>
            <audio></audio>
        </div>
    `;

    const audio = historyPlayerContainer.querySelector('audio');
    const btnPlay = historyPlayerContainer.querySelector('.play-btn');
    const progressBar = historyPlayerContainer.querySelector('.progress-bar');
    const progressFill = historyPlayerContainer.querySelector('.progress-fill');
    const currentTimeEl = historyPlayerContainer.querySelector('.time-display.current');
    const durationEl = historyPlayerContainer.querySelector('.time-display.duration');

    // 复用通用迷你播放器逻辑
    setupMiniPlayer(
        audio,
        btnPlay,
        progressFill,
        currentTimeEl,
        durationEl,
        progressBar
    );

    historyPlayerAudio = audio;
    return { container: historyPlayerContainer, audio: historyPlayerAudio };
}

/**
 * 播放某条历史记录，在对应卡片下方显示进度条
 */
window.playHistoryItem = function (index) {
    const item = state.history[index];
    if (!item) return;

    try {
        const audioUrl = window.api.getAudioUrl(item.audio_url || item.audioUrl);

        const historyList = document.getElementById('historyList');
        if (!historyList) return;

        const targetItem = historyList.querySelector(`.history-item[data-index="${index}"]`);
        if (!targetItem) return;

        const { container, audio } = getHistoryPlayer();

        // 如果播放器已经挂在别处，先移除，再插入到当前卡片下方
        if (container.parentElement) {
            container.parentElement.removeChild(container);
        }
        targetItem.insertAdjacentElement('afterend', container);

        // 确保可见
        container.classList.remove('hidden');

        // 设置音频并播放
        audio.src = audioUrl;
        audio.play().catch(e => console.error('History playback failed:', e));

        const msg = state.lang === 'zh' ? '正在播放历史音频' : 'Playing history audio';
        showToast(msg, 'info');
    } catch (e) {
        console.error('Error playing history item:', e);
        const msg = state.lang === 'zh' ? '历史音频播放失败' : 'Failed to play history audio';
        showToast(msg, 'error');
    }
};

/**
 * Setup settings
 */
function setupSettings() {
    // Theme
    elements.themeSelect?.addEventListener('change', (e) => {
        setTheme(e.target.value);
    });

    // Max tokens
    elements.maxTokens?.addEventListener('change', (e) => {
        state.settings.maxTokens = parseInt(e.target.value);
        saveSettings();
    });

    // Temperature
    elements.temperature?.addEventListener('change', (e) => {
        state.settings.temperature = parseFloat(e.target.value);
        saveSettings();
    });

    // Precision mode selector
    elements.precisionModeSelect?.addEventListener('change', async (e) => {
        const newMode = e.target.value;
        try {
            const result = await window.api.setSettings({ precision_mode: newMode });
            localStorage.setItem('precisionMode', newMode);

            if (result.needs_reload) {
                showToast(
                    `${tr('toast.precision_changed_prefix', 'Precision changed to')} ${newMode.toUpperCase()}. ${tr('toast.precision_reload_suffix', 'Reload model to apply.')}`,
                    'warning'
                );
            } else {
                showToast(
                    `${tr('toast.precision_set_prefix', 'Precision mode set to')} ${newMode.toUpperCase()}`,
                    'success'
                );
            }
        } catch (error) {
            showToast(
                `${tr('toast.precision_failed_prefix', 'Failed to change precision')}: ${error.message}`,
                'error'
            );
            // Revert UI
            await checkApiStatus();
        }
    });

    // Model unload button
    elements.btnUnloadModel?.addEventListener('click', async () => {
        const confirmMsg = state.lang === 'zh'
            ? '卸载模型并释放显存？\n\n卸载后需要重新加载模型才能继续合成语音。'
            : 'Unload the model and release VRAM?\n\nYou will need to reload the model before generating speech.';
        if (!confirm(confirmMsg)) {
            return;
        }

        try {
            elements.btnUnloadModel.disabled = true;
            elements.btnUnloadModel.textContent = 'Unloading...';

            await window.api.unloadModel();
            showToast(tr('toast.model_unloaded', 'Model unloaded, VRAM released'), 'success');

            // Refresh status
            await checkApiStatus();
        } catch (error) {
            showToast(
                `${tr('toast.model_unload_failed_prefix', 'Failed to unload')}: ${error.message}`,
                'error'
            );
        } finally {
            elements.btnUnloadModel.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Unload Model
            `;
        }
    });

    // Model load button
    elements.btnLoadModel?.addEventListener('click', async () => {
        try {
            elements.btnLoadModel.disabled = true;
            elements.btnLoadModel.textContent = 'Starting...';

            await window.api.loadModel();
            showToast(tr('toast.model_loading_started', 'Model loading started...'), 'success');

            // Start polling for status
            showLoadingOverlay('Loading TTS model...');
            await checkApiStatus();
        } catch (error) {
            showToast(
                `${tr('toast.model_load_failed_prefix', 'Failed to load')}: ${error.message}`,
                'error'
            );
        } finally {
            elements.btnLoadModel.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="1 4 1 10 7 10"/>
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
                Load Model
            `;
        }
    });

    // Clear history button
    elements.btnClearHistory?.addEventListener('click', async () => {
        const msg = state.lang === 'zh'
            ? '确定要删除所有生成历史和物理文件吗？此操作不可恢复。'
            : 'Are you sure you want to delete all generation history and physical files? This action cannot be undone.';

        if (!confirm(msg)) return;

        try {
            await window.api.clearHistory();
            state.history = [];
            updateHistoryUI();

            const successMsg = state.lang === 'zh' ? '历史记录已清空' : 'History cleared';
            showToast(successMsg, 'success');
        } catch (error) {
            showToast(
                `${tr('toast.history_clear_failed_prefix', 'Clear failed')}: ${error.message}`,
                'error'
            );
        }
    });
}

/**
 * Set theme
 */
function setTheme(theme) {
    state.settings.theme = theme;

    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
    } else {
        document.documentElement.dataset.theme = theme;
    }

    if (window.electronAPI) {
        window.electronAPI.setTheme(theme);
    }

    saveSettings();
}

/**
 * Load saved settings
 */
function loadSettings() {
    try {
        const saved = localStorage.getItem('indextts_settings');
        if (saved) {
            Object.assign(state.settings, JSON.parse(saved));
        }
    } catch (e) { }

    // Apply settings
    if (elements.themeSelect) elements.themeSelect.value = state.settings.theme;
    if (elements.maxTokens) elements.maxTokens.value = state.settings.maxTokens;
    if (elements.temperature) elements.temperature.value = state.settings.temperature;

    setTheme(state.settings.theme);
}

/**
 * Save settings
 */
function saveSettings() {
    try {
        localStorage.setItem('indextts_settings', JSON.stringify(state.settings));
    } catch (e) { }
}

/**
 * Initialize API and check connection with robust retry logic
 */
async function initializeAPI() {
    try {
        // Show initial loading overlay while we wait for the backend
        showLoadingOverlay('Initializing...');
        startLoadingSimulator();

        await window.api.init();
        await checkApiStatus();

    } catch (error) {
        console.error('API init error:', error);

        state.connectionRetries++;
        const displayCount = state.connectionRetries;

        if (displayCount <= state.maxRetries) {
            elements.statusDot?.classList.add('offline');
            const msg = tr('status.dl_modules', 'Initializing deep learning modules ({n}/{max})...')
                .replace('{n}', String(displayCount))
                .replace('{max}', String(state.maxRetries));

            elements.statusText.textContent = msg;
            if (elements.apiStatus) elements.apiStatus.textContent = msg;

            if (!state.loadingSimulator.isActive) {
                showLoadingOverlay('Initializing...', 5);
                startLoadingSimulator();
            }
            if (elements.loadingStatus) {
                elements.loadingStatus.textContent = msg;
            }

            setTimeout(initializeAPI, 2000);
        } else {
            elements.statusText.textContent = 'Connection Timeout';
            showToast(tr('toast.backend_timeout', 'Backend failed to start in time. Please check logs.'), 'error');
            if (window.electronAPI) {
                setRuntimeWizardVisible(true, tr('wizard.desc', 'Backend runtime or model files are not ready.'));
            }
        }
    }
}

/**
 * Check API status and poll if loading
 */
async function checkApiStatus() {
    try {
        // Use a timeout for the check to avoid hanging if the backend is partially responsive
        const apiStatus = await window.api.getStatus();
        const status = { connected: true, modelReady: !!apiStatus.model_loaded };

        // Reset connection retries on success
        state.connectionRetries = 0;

        // Update connection status text
        const statusKey = status.connected ? 'connected' : 'offline';
        // We will update local text if needed, but connection status is usually dynamic

        if (status.connected) {
            elements.apiStatus.textContent = state.lang === 'zh' ? '已连接' : 'Connected';
            elements.apiStatus.classList.remove('offline');
            elements.apiStatus.classList.add('online');

            pushTrayStatus('connected', apiStatus);

            // Check model status
            // If health endpoint already reports model ready, reflect that immediately
            if (status.modelReady) {
                elements.statusDot?.classList.remove('offline');
                elements.statusDot?.classList.add('online');
                completeLoadingSmoothly();
            }

            try {
                // Status payload already fetched above

                // Update VRAM display
                updateVramDisplay(apiStatus);

                // Update model control UI
                updateModelControlUI(apiStatus);

                if (apiStatus.model_loaded) {
                    completeLoadingSmoothly();
                    setRuntimeWizardVisible(false);
                    elements.statusDot?.classList.remove('offline');
                    elements.statusDot?.classList.add('online');
                    startStatusPolling();
                    await loadVoices();
                } else if (apiStatus.loading) {
                    // Model is loading - show overlay with progress
                    const backendProgress = apiStatus.load_progress || 0;
                    const stage = apiStatus.load_stage || 'Loading...';

                    // Start simulator if not already running
                    if (!state.loadingSimulator.isActive) {
                        showLoadingOverlay(stage, 0);
                        startLoadingSimulator();
                    }

                    syncSimulatorWithBackend(backendProgress, stage);

                    elements.statusDot?.classList.remove('offline', 'online');
                    const displayProgress = Math.floor(state.loadingSimulator.currentProgress);
                    elements.statusText.textContent = `${getTranslatedStage(stage)} ${displayProgress}%`;

                    // Poll quickly so overlay % stays in lockstep with the backend
                    setTimeout(checkApiStatus, 1200);
                } else {
                    // Model not loaded - stop simulator and hide overlay, show status
                    stopLoadingSimulator();
                    hideLoadingOverlay();
                    elements.statusDot?.classList.add('offline');
                    if (apiStatus.load_error) {
                        elements.statusText.textContent = getTranslatedStage('Finalizing...');
                        showToast(
                            `${tr('toast.model_load_error_prefix', 'Model load error')}: ${apiStatus.load_error}`,
                            'error'
                        );
                        setRuntimeWizardVisible(true, `${tr('wizard.desc', 'Backend runtime or model files are not ready.')}\n${apiStatus.load_error}`);
                    } else {
                        elements.statusText.textContent = getTranslatedStage('Loading model...');
                    }

                    // Stop periodic polling while model is not loaded
                    stopStatusPolling();
                }
            } catch (e) {
                // Status endpoint might fail, still try to load voices
                hideLoadingOverlay();
                await loadVoices();
            }
        } else {
            // Server offline - show overlay with connection status and start simulator
            if (!state.loadingSimulator.isActive) {
                showLoadingOverlay('Starting server...', 0);
                startLoadingSimulator();
            }
            elements.statusDot?.classList.add('offline');
            elements.statusText.textContent = `${getTranslatedStage('Starting...')} ${Math.floor(state.loadingSimulator.currentProgress)}%`;
            elements.apiStatus.textContent = tr('status.starting_short', 'Starting...');
            elements.apiStatus.classList.add('offline');
            elements.apiStatus.classList.remove('online');

            pushTrayStatus('starting');
            setTimeout(checkApiStatus, 1500);
        }
    } catch (error) {
        console.error('Status check error:', error);
        // Start simulator on connection error too
        if (!state.loadingSimulator.isActive) {
            showLoadingOverlay('Starting...', 0);
            startLoadingSimulator();
        }
        elements.statusText.textContent = `${getTranslatedStage('Starting...')} ${Math.floor(state.loadingSimulator.currentProgress)}%`;
        pushTrayStatus('starting');
        setTimeout(checkApiStatus, 1500);
    }
}

const stageMapping = {
    'Initializing...': 'status.connecting',
    'Connecting to server...': 'status.connecting',
    'Starting server...': 'status.starting',
    'Starting...': 'status.starting',
    'Loading model...': 'status.loading_model',
    'Loading...': 'status.loading_model',
    'Loading': 'status.loading_model',
    'Importing torch...': 'status.importing_torch',
    'Importing transformers...': 'status.importing_transformers',
    'Importing VoxAI engine...': 'status.importing_engine',
    'Importing IndexTTS engine...': 'status.importing_engine',
    'Importing modules...': 'status.importing',
    'Loading configuration...': 'status.loading_config',
    'Loading GPT model...': 'status.loading_gpt',
    'Loading Qwen emotion...': 'status.loading_qwen',
    'Loading semantic encoder...': 'status.loading_semantic',
    'Restoring semantic codec...': 'status.loading_codec',
    'Restoring acoustic model...': 'status.loading_s2mel',
    'Restoring speaker encoder...': 'status.loading_campplus',
    'Restoring vocoder...': 'status.loading_vocoder',
    'Loading tokenizer...': 'status.loading_tokenizer',
    'Loading emotion matrices...': 'status.loading_emo_matrix',
    'Restoring model weights...': 'status.restoring_weights',
    'Phase 1 Complete': 'status.finalizing',
    'Finalizing...': 'status.finalizing',
    'Ready': 'status.ready'
};

function resolveStageKey(stage) {
    if (!stage) return '';
    const cleaned = String(stage).replace(/\s+\d+%\s*$/, '').trim();
    if (stageMapping[cleaned]) return stageMapping[cleaned];
    const packs = window.translations || {};
    for (const lang of Object.keys(packs)) {
        const dict = packs[lang];
        for (const [key, value] of Object.entries(dict)) {
            if (typeof value !== 'string' || !key.startsWith('status.')) continue;
            if (value === cleaned || value === stage) return key;
        }
    }
    return '';
}

function canonicalStageFromKey(key) {
    return Object.keys(stageMapping).find((name) => stageMapping[name] === key) || key;
}

function getTranslatedStage(stage) {
    if (!stage) return '';
    const key = resolveStageKey(stage);
    if (key) {
        state.statusStage = canonicalStageFromKey(key);
        return tr(key, stage);
    }
    state.statusStage = String(stage).replace(/\s+\d+%\s*$/, '').trim();
    return stage;
}

function refreshTranslatedStatus() {
    const overlayLabel = getTranslatedStage(state.statusStage || 'Initializing...');
    if (elements.loadingStatus) {
        elements.loadingStatus.textContent = overlayLabel;
    }
    if (elements.statusText) {
        if (state.loadingSimulator?.isActive) {
            const stageLabel = getTranslatedStage(state.statusStage || 'Loading');
            elements.statusText.textContent = `${stageLabel} ${Math.floor(state.loadingSimulator.currentProgress)}%`;
        } else {
            elements.statusText.textContent = overlayLabel;
        }
    }
}

/**
 * Show loading overlay with status message and progress
 */
function showLoadingOverlay(message, progress = 0) {
    if (elements.loadingOverlay) {
        elements.loadingOverlay.classList.remove('hidden');
        elements.loadingOverlay.classList.remove('fade-out');
    }
    const appRoot = document.querySelector('.app-container');
    if (appRoot) {
        appRoot.classList.add('app-pending');
        appRoot.classList.remove('app-reveal');
    }
    if (elements.loadingStatus) {
        elements.loadingStatus.textContent = getTranslatedStage(message);
    }
    if (state.loadingSimulator.isActive) {
        updateLoadingProgress(state.loadingSimulator.currentProgress);
    } else {
        updateLoadingProgress(progress);
    }

    setAppButtonsEnabled(false);
}

/**
 * Hide loading overlay with smooth transition
 */
function hideLoadingOverlay() {
    if (!elements.loadingOverlay) return;

    if (elements.loadingOverlay.classList.contains('hidden') ||
        elements.loadingOverlay.classList.contains('fade-out')) {
        setAppButtonsEnabled(true);
        return;
    }

    const appRoot = document.querySelector('.app-container');
    setTimeout(() => {
        if (appRoot) {
            appRoot.classList.remove('app-pending');
            appRoot.classList.add('app-reveal');
        }
        elements.loadingOverlay.classList.add('fade-out');

        setTimeout(() => {
            elements.loadingOverlay.classList.add('hidden');
            elements.loadingOverlay.classList.remove('fade-out');
            setAppButtonsEnabled(true);
        }, 800);
    }, 420);
}

function formatLoadPercent(progress) {
    if (progress >= 99.95) return '100%';
    return `${progress.toFixed(1)}%`;
}

/**
 * Update loading progress bar and percentage
 */
function updateLoadingProgress(progress, stage = null) {
    const sim = state.loadingSimulator;
    const painted = Math.round(progress * 10);
    if (elements.loadingProgressBar) {
        elements.loadingProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
        elements.loadingProgressBar.classList.remove('animating');
    }
    if (elements.loadingPercent && sim.lastPainted !== painted) {
        sim.lastPainted = painted;
        elements.loadingPercent.textContent = formatLoadPercent(progress);
    }
    if (stage && elements.loadingStatus) {
        elements.loadingStatus.textContent = getTranslatedStage(stage);
    }
}

function tickLoadingProgress(now) {
    const sim = state.loadingSimulator;
    if (!sim.isActive) return;

    if (!sim.lastTs) sim.lastTs = now;
    const dt = Math.min(0.05, Math.max(0.008, (now - sim.lastTs) / 1000));
    sim.lastTs = now;

    let visualTarget;
    if (sim.completing) {
        visualTarget = 100;
    } else if (!sim.backendConnected) {
        visualTarget = 8;
    } else {
        visualTarget = Math.min(sim.targetProgress, 99.2);
    }

    if (sim.currentProgress > visualTarget) {
        sim.currentProgress = visualTarget;
        sim.velocity = 0;
    }

    const gap = visualTarget - sim.currentProgress;
    if (gap > 0.001) {
        const omega = sim.completing ? 7.2 : (gap > 10 ? 6.0 : 4.2);
        const zeta = 1.08;
        sim.velocity += (gap * omega * omega - 2 * zeta * omega * sim.velocity) * dt;
        const maxSpeed = sim.completing ? 70 : (gap > 12 ? 38 : 26);
        if (sim.velocity > maxSpeed) sim.velocity = maxSpeed;
        sim.currentProgress += sim.velocity * dt;
        if (sim.currentProgress > visualTarget) {
            sim.currentProgress = visualTarget;
            sim.velocity *= 0.25;
        }
    } else {
        sim.currentProgress = visualTarget;
        sim.velocity = 0;
    }

    updateLoadingProgress(sim.currentProgress);
    if (elements.statusText) {
        const stageLabel = getTranslatedStage(state.statusStage || 'Starting...');
        elements.statusText.textContent = `${stageLabel} ${Math.floor(sim.currentProgress)}%`;
    }

    if (sim.completing && sim.currentProgress >= 99.55) {
        sim.currentProgress = 100;
        updateLoadingProgress(100, 'Ready');
        if (elements.statusText) {
            elements.statusText.textContent = getTranslatedStage('Ready');
        }
        stopLoadingSimulator();
        hideLoadingOverlay();
        return;
    }

    sim.rafId = requestAnimationFrame(tickLoadingProgress);
}

/**
 * Start the loading progress ticker.
 * Backend reports in jumps; the overlay eases toward each new target.
 */
function startLoadingSimulator() {
    if (state.loadingSimulator.isActive) return;

    const sim = state.loadingSimulator;
    sim.isActive = true;
    sim.completing = false;
    sim.backendConnected = false;
    sim.velocity = 0;
    sim.lastTs = 0;
    sim.lastPainted = -1;
    sim.lastBackendAt = performance.now();
    if (sim.currentProgress >= 99.5 || sim.lastBackendProgress >= 99) {
        sim.currentProgress = 0;
        sim.lastBackendProgress = 0;
        sim.targetProgress = 0;
    } else {
        sim.targetProgress = sim.lastBackendProgress || 0;
    }

    sim.rafId = requestAnimationFrame(tickLoadingProgress);
    console.log('[Progress] Loading ticker started');
}

/**
 * Stop the loading progress ticker
 */
function stopLoadingSimulator() {
    const sim = state.loadingSimulator;
    if (sim.rafId) {
        cancelAnimationFrame(sim.rafId);
        sim.rafId = null;
    }
    if (sim.intervalId) {
        clearInterval(sim.intervalId);
        sim.intervalId = null;
    }
    sim.isActive = false;
    sim.backendConnected = false;
    sim.completing = false;
    sim.velocity = 0;
    sim.lastTs = 0;
    sim.lastBackendProgress = 0;
    sim.targetProgress = 0;
    console.log('[Progress] Loading ticker stopped');
}

/**
 * Backend progress is the floor. Display eases toward it (and slightly ahead while a stage is running).
 */
function syncSimulatorWithBackend(backendProgress, stage) {
    const sim = state.loadingSimulator;
    const next = Number(backendProgress) || 0;
    sim.backendConnected = true;
    if (next > sim.lastBackendProgress + 0.05) {
        sim.lastBackendAt = performance.now();
        if (sim.velocity < 4) sim.velocity = 4;
    }
    sim.lastBackendProgress = next;
    sim.targetProgress = next;
    if (stage) {
        updateLoadingProgress(sim.currentProgress, stage);
    }
}

/**
 * Ease the last stretch to 100%, then fade the overlay.
 */
function completeLoadingSmoothly() {
    const sim = state.loadingSimulator;
    if (!sim.isActive) startLoadingSimulator();
    sim.backendConnected = true;
    sim.completing = true;
    sim.targetProgress = 100;
    sim.lastBackendProgress = 100;
    sim.lastBackendAt = performance.now();
    getTranslatedStage('Ready');
}

/**
 * Start periodic status polling (every 10s) to keep tray GPU/VRAM labels updated
 */
function startStatusPolling() {
    // Avoid duplicate intervals
    if (state.statusPollIntervalId) return;

    state.statusPollIntervalId = setInterval(async () => {
        try {
            const apiStatus = await window.api.getStatus();

            // Update VRAM display in settings
            updateVramDisplay(apiStatus);
            pushTrayStatus('connected', apiStatus);

            // If model got unloaded externally, stop polling
            if (!apiStatus.model_loaded) {
                stopStatusPolling();
                updateModelControlUI(apiStatus);
            }
        } catch (e) {
            console.log('[StatusPoll] Status check failed:', e.message);
        }
    }, 10000); // Every 10 seconds

    console.log('[StatusPoll] Started periodic status polling');
}

/**
 * Stop periodic status polling
 */
function stopStatusPolling() {
    if (state.statusPollIntervalId) {
        clearInterval(state.statusPollIntervalId);
        state.statusPollIntervalId = null;
        console.log('[StatusPoll] Stopped periodic status polling');
    }
}

/**
 * Enable/disable all main action buttons
 */
function setAppButtonsEnabled(enabled) {
    const buttons = [
        elements.btnGenerate,
        elements.btnExport,
        elements.voiceDropZone,
        elements.textInput
    ];

    buttons.forEach(el => {
        if (el) {
            if (el.tagName === 'BUTTON') {
                el.disabled = !enabled;
            } else if (el.tagName === 'TEXTAREA') {
                el.disabled = !enabled;
            } else {
                el.style.pointerEvents = enabled ? 'auto' : 'none';
                el.style.opacity = enabled ? '1' : '0.5';
            }
        }
    });
}

function formatGb(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '--';
    }
    return Number(value).toFixed(2);
}

function formatVramTriple(status) {
    return `${formatGb(status?.vram_app_gb)} / ${formatGb(status?.vram_used_gb)} / ${formatGb(status?.vram_total_gb)} GB`;
}

function deriveTrayModePayload(apiStatus) {
    if (!apiStatus) return { mode: 'unknown', vram: null };
    const device = String(apiStatus.device || '').toLowerCase();
    if (device.includes('cuda') || apiStatus.cuda_available) {
        const vram = formatVramTriple(apiStatus);
        return {
            mode: 'gpu',
            vram: vram.startsWith('-- / -- / --') ? null : vram
        };
    }
    if (device.includes('cpu') || (apiStatus.model_loaded && !apiStatus.cuda_available)) {
        return { mode: 'cpu', vram: null };
    }
    return { mode: 'unknown', vram: null };
}

function pushTrayStatus(backend, apiStatus) {
    if (!window.electronAPI) return;
    const payload = { backend, ...deriveTrayModePayload(apiStatus) };
    try {
        if (typeof window.electronAPI.setTrayStatus === 'function') {
            window.electronAPI.setTrayStatus(payload);
            return;
        }
        const zh = state.lang === 'zh';
        const backendLabel = backend === 'connected'
            ? (zh ? '后端：已连接' : 'Backend: connected')
            : backend === 'offline'
                ? (zh ? '后端：离线' : 'Backend: offline')
                : (zh ? '后端：启动中…' : 'Backend: starting…');
        let modeLabel = zh ? '模式：--' : 'Mode: --';
        if (payload.mode === 'gpu') {
            modeLabel = payload.vram
                ? (zh ? `模式：GPU（${payload.vram}）` : `Mode: GPU (${payload.vram})`)
                : (zh ? '模式：GPU' : 'Mode: GPU');
        } else if (payload.mode === 'cpu') {
            modeLabel = zh ? '模式：CPU' : 'Mode: CPU';
        }
        window.electronAPI.setTrayBackendStatus?.(backendLabel);
        window.electronAPI.setTrayModeStatus?.(modeLabel);
    } catch (e) { }
}

/**
 * Update VRAM display
 */
function updateVramDisplay(status) {
    if (elements.vramApp) {
        elements.vramApp.textContent = formatGb(status.vram_app_gb);
    }
    if (elements.vramDevice) {
        elements.vramDevice.textContent = formatGb(status.vram_used_gb);
    }
    if (elements.vramTotal) {
        elements.vramTotal.textContent = formatGb(status.vram_total_gb);
    }

    if (elements.runtimeMode) {
        const device = String(status.device || '').toLowerCase();
        let label = '--';
        if (device.includes('cuda') || status.cuda_available) {
            label = state.lang === 'zh' ? 'GPU 模式' : 'GPU mode';
        } else if (device.includes('cpu') || (status.model_loaded && !status.cuda_available)) {
            label = state.lang === 'zh' ? 'CPU 模式' : 'CPU mode';
        }
        elements.runtimeMode.textContent = label;
    }
}

/**
 * Update model control UI based on status
 */
function updateModelControlUI(status) {
    if (!status) return;
    state.lastApiStatus = status;

    if (elements.modelStatusBadge) {
        if (status.model_loaded) {
            elements.modelStatusBadge.textContent = tr('status.model_loaded', 'Loaded');
            elements.modelStatusBadge.className = 'status-badge online';
        } else if (status.loading) {
            elements.modelStatusBadge.textContent = tr('status.model_loading', 'Loading...');
            elements.modelStatusBadge.className = 'status-badge loading';
        } else {
            elements.modelStatusBadge.textContent = tr('status.model_not_loaded', 'Not Loaded');
            elements.modelStatusBadge.className = 'status-badge offline';
        }
    }

    if (elements.modelStatusDesc) {
        if (status.model_loaded) {
            elements.modelStatusDesc.textContent = `${tr('status.running_on_prefix', 'Running on')} ${status.device}`;
        } else if (status.loading) {
            elements.modelStatusDesc.textContent = tr('status.please_wait', 'Please wait...');
        } else if (status.load_error) {
            elements.modelStatusDesc.textContent = status.load_error;
        } else {
            elements.modelStatusDesc.textContent = tr('status.click_load', 'Click Load Model to start');
        }
    }

    // Button states
    if (elements.btnUnloadModel) {
        elements.btnUnloadModel.disabled = !status.model_loaded || status.loading;
    }
    if (elements.btnLoadModel) {
        elements.btnLoadModel.disabled = status.model_loaded || status.loading;
    }

    // Precision mode selector
    if (elements.precisionModeSelect && status.precision_mode) {
        elements.precisionModeSelect.value = status.precision_mode;
    }
}

/**
 * Load available voices
 */
async function loadVoices() {
    try {
        const voices = await window.api.getVoices();

        // Populate voice select
        const defaultVoiceOption = tr('select.default', '-- Select a voice --');
        const optionsHtml = `<option value="" data-i18n="select.default">${defaultVoiceOption}</option>` +
            voices.map(v => `<option value="${v.path}">${v.name}</option>`).join('');

        if (elements.voiceSelect) {
            elements.voiceSelect.innerHTML = optionsHtml;
        }

        // Populate emotion select
        if (elements.emotionSelect) {
            elements.emotionSelect.innerHTML = optionsHtml;
        }

        // Update voice grid
        updateVoiceGrid(voices);
    } catch (error) {
        console.error('Failed to load voices:', error);
    }
}

/**
 * Update voice grid in library panel
 */
function updateVoiceGrid(voices) {
    if (!elements.voiceGrid) return;

    if (voices.length === 0) {
        const title = tr('library.empty_title', 'No voices in library');
        const hint = tr('library.empty_hint', 'Upload voice reference files to get started');
        elements.voiceGrid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <p>${title}</p>
                <p class="hint">${hint}</p>
            </div>
        `;
        return;
    }

    elements.voiceGrid.innerHTML = voices.map(v => `
        <div class="voice-card" data-path="${escapeHtml(v.path)}">
            <div class="voice-card-name" title="${escapeHtml(v.name)}">${escapeHtml(v.name)}</div>
            <div class="voice-card-meta">${tr('voice.card_meta_click_to_use', 'Click to use')}</div>
        </div>
    `).join('');

    // Add click handlers
    elements.voiceGrid.querySelectorAll('.voice-card').forEach(card => {
        card.addEventListener('click', () => {
            const vPath = card.dataset.path;
            const vName = card.querySelector('.voice-card-name').textContent;

            state.voicePath = vPath;

            // Update UI components
            if (elements.voiceSelect) elements.voiceSelect.value = vPath;
            if (elements.voiceName) elements.voiceName.textContent = vName;

            if (elements.voiceAudio) {
                elements.voiceAudio.src = window.api.getAudioUrl(vPath);
            }

            if (elements.voicePreview) elements.voicePreview.classList.remove('hidden');
            if (elements.voiceDropZone) elements.voiceDropZone.classList.add('hidden');

            switchPanel('synthesis');
            showToast(state.lang === 'zh' ? '已选择语音' : 'Voice selected', 'success');
        });
    });
}

function setRuntimeWizardVisible(visible, message = '') {
    if (!elements.runtimeModal) return;
    elements.runtimeModal.classList.toggle('hidden', !visible);
    state.runtimeWizardVisible = visible;
    if (message && elements.runtimeWizardMessage) {
        elements.runtimeWizardMessage.textContent = message;
    }
}

function setupRuntimeWizard() {
    if (!window.electronAPI) return;

    elements.btnWizardClose?.addEventListener('click', () => {
        setRuntimeWizardVisible(false);
    });

    elements.btnWizardPickModel?.addEventListener('click', async () => {
        const result = await window.electronAPI.pickModelDir();
        if (!result || !result.success) return;
        showToast(tr('toast.model_dir_saved', 'Model folder saved, restarting backend...'), 'success');
        await window.electronAPI.selfHealBackend();
        setRuntimeWizardVisible(false);
        setTimeout(() => checkApiStatus().catch(() => { }), 1200);
    });

    elements.btnWizardRepairRuntime?.addEventListener('click', async () => {
        const result = await window.electronAPI.runtimeRepair();
        if (state.isPackaged) {
            if (result && result.success) {
                showToast(tr('toast.runtime_verify_ok', 'Bundled runtime is healthy'), 'success');
            } else {
                const errMsg = result?.message || tr('toast.runtime_verify_fail', 'Bundled runtime is broken, please reinstall VoxAI Studio');
                showToast(`${tr('toast.runtime_verify_fail', 'Bundled runtime is broken, please reinstall VoxAI Studio')}: ${errMsg}`, 'error');
            }
            return;
        }

        showToast(tr('status.finalizing', 'Finalizing...'), 'info');
        if (result && result.success) {
            showToast(tr('toast.runtime_repair_ok', 'Runtime repair completed'), 'success');
        } else {
            const errMsg = result?.message || tr('toast.runtime_repair_fail', 'Runtime repair failed');
            showToast(`${tr('toast.runtime_repair_fail', 'Runtime repair failed')}: ${errMsg}`, 'error');
        }
    });

    elements.btnWizardSelfHeal?.addEventListener('click', async () => {
        const result = await window.electronAPI.selfHealBackend();
        if (result && result.success) {
            showToast(tr('toast.self_heal_ok', 'Backend restart requested'), 'success');
            setRuntimeWizardVisible(false);
            setTimeout(() => checkApiStatus().catch(() => { }), 1200);
        } else {
            showToast(result?.message || 'Backend restart failed', 'error');
        }
    });

    elements.btnWizardDownloadModel?.addEventListener('click', () => {
        const url = 'https://huggingface.co/IndexTeam/IndexTTS-2.5';
        window.electronAPI.openExternal(url);
    });

    elements.btnWizardDiagnostics?.addEventListener('click', async () => {
        const result = await window.electronAPI.exportDiagnostics();
        if (result && result.success) {
            showToast(`${tr('toast.diag_export_ok', 'Diagnostics exported')}: ${result.path}`, 'success');
        } else {
            showToast(`${tr('toast.diag_export_fail', 'Diagnostics export failed')}: ${result?.message || ''}`, 'error');
        }
    });
}

async function probeRuntimeReadiness() {
    if (!window.electronAPI || state.runtimeChecked) return;
    state.runtimeChecked = true;
    try {
        const rt = await window.electronAPI.getRuntimeStatus();
        state.isPackaged = !!rt.isPackaged;
        if (elements.btnWizardRepairRuntime) {
            elements.btnWizardRepairRuntime.textContent = state.isPackaged
                ? tr('wizard.verify_runtime', state.lang === 'zh' ? '校验运行时' : 'Verify Runtime')
                : tr('wizard.repair_runtime', state.lang === 'zh' ? '修复运行时' : 'Repair Runtime');
        }
        const issues = [];
        if (!rt.scriptExists) issues.push(state.lang === 'zh' ? '缺少 api_server.py' : 'api_server.py is missing');
        if (!rt.pythonExec) issues.push(state.lang === 'zh' ? '未检测到可用 Python 运行时' : 'No usable Python runtime found');
        if (rt.isPackaged && rt.bundledRuntimeHealthy === false) {
            issues.push(rt.bundledRuntimeMessage || (state.lang === 'zh'
                ? '内置运行时校验失败，请重装应用'
                : 'Bundled runtime check failed, please reinstall app'));
        }
        if (!rt.modelConfigFound || !rt.modelVocabFound) {
            issues.push(state.lang === 'zh' ? '模型文件未就绪，请选择 checkpoints 目录' : 'Model files not ready, please select checkpoints folder');
        }
        if (issues.length > 0) {
            state.lastRuntimeIssue = issues.join('\n');
            setRuntimeWizardVisible(true, issues.join('\n'));
        }
    } catch (e) {
        console.warn('Runtime probe failed:', e);
    }
}

/**
 * Setup Electron-specific listeners
 */
function setupElectronListeners() {
    if (!window.electronAPI) return;

    window.electronAPI.onQuickSynthesize(() => {
        if (state.voicePath && elements.textInput.value.trim()) {
            generateSpeech();
        }
    });

    window.electronAPI.onOpenSettings(() => {
        switchPanel('settings');
    });
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    elements.toastContainer?.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Utility: Capitalize first letter
 */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Utility: Escape HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Setup language
 */
/**
 * Setup language
 */
function setupLanguage() {
    // Load saved language
    const savedLang = localStorage.getItem('indextts_lang');
    if (savedLang && (savedLang === 'en' || savedLang === 'zh')) {
        state.lang = savedLang;
    }

    // Button listeners
    document.querySelectorAll('.lang-btn[data-ui-lang]').forEach((btn) => {
        btn.addEventListener('click', () => setLanguage(btn.dataset.uiLang));
    });
    document.getElementById('btnMinimizeLoading')?.addEventListener('click', () => {
        if (window.electronAPI && typeof window.electronAPI.minimize === 'function') {
            window.electronAPI.minimize();
        }
    });
    document.getElementById('btnQuitLoading')?.addEventListener('click', () => {
        if (window.electronAPI && typeof window.electronAPI.quit === 'function') {
            window.electronAPI.quit();
            return;
        }
        window.close();
    });
    document.getElementById('btnReloadUi')?.addEventListener('click', () => {
        if (window.electronAPI && typeof window.electronAPI.reloadWindow === 'function') {
            window.electronAPI.reloadWindow();
            return;
        }
        window.location.reload();
    });

    // Apply language
    setLanguage(state.lang);
}

/**
 * Set and apply language
 */
function setLanguage(lang) {
    state.lang = lang;
    localStorage.setItem('indextts_lang', lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    // Update buttons
    document.querySelectorAll('.lang-btn[data-ui-lang]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.uiLang === lang);
    });

    // Sync language to Electron main process (tray, etc.) if available
    if (window.electronAPI && typeof window.electronAPI.setLang === 'function') {
        try {
            window.electronAPI.setLang(lang);
        } catch (e) {
            console.warn('Failed to sync language to main process:', e);
        }
    }

    applyLanguage(lang);
}

/**
 * Apply language to UI
 */
function applyLanguage(lang) {
    if (!window.translations || !window.translations[lang]) return;

    const t = window.translations[lang];

    // Helper to safe update
    const setText = (selector, key) => {
        const el = document.querySelector(selector);
        if (el && t[key]) el.textContent = t[key];
    };

    const setHtml = (selector, key) => {
        const el = document.querySelector(selector);
        if (el && t[key]) el.innerHTML = t[key];
    }

    // Helper for placeholders
    const setPlaceholder = (selector, key) => {
        const el = document.querySelector(selector);
        if (el && t[key]) el.placeholder = t[key];
    };

    // Navigation
    // Use data-i18n attributes ideally, but for now manual mapping if attributes are missing
    // or we can iterate over elements with data-i18n

    // Apply via data-i18n attributes (skip dynamic status keys)
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (!key || key.startsWith('status.')) {
            return; // status texts are controlled dynamically via JS
        }
        if (t[key]) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (el.type === 'placeholder') {
                    el.placeholder = t[key];
                }
            } else {
                // Check if it has child nodes that shouldn't be overwritten (like icons)
                // For buttons with icons, we usually wrap text in a span. 
                // If not, we might need a specific structure.
                // For now, assume text content is safe to replace if it's a label or similar.

                // Special handling for elements with icons where we want to preserve the icon
                if (el.children.length > 0 && el.querySelector('svg')) {
                    // Try to find a text node or a span
                    // This is tricky without changing HTML structure.
                    // We will rely on HTML changes that wrap text in <span> or just target the text node.
                    // Simplest: Target the text span if it exists, or lastChild if it is text.
                    const textNode = Array.from(el.childNodes).find(n => n.nodeType === 3 && n.textContent.trim().length > 0);
                    if (textNode) {
                        textNode.textContent = t[key];
                    } else {
                        // Maybe it's inside a span?
                        const span = el.querySelector('span:not(.status-dot):not(.slider-round)');
                        if (span) span.textContent = t[key];
                    }
                } else {
                    el.textContent = t[key];
                }
            }
        }
    });

    // Handle placeholders specifically
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (t[key]) el.placeholder = t[key];
    });

    // Handle titles specifically
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        if (t[key]) el.title = t[key];
    });

    // Update dynamic voice-card meta text ("Click to use") when switching language
    document.querySelectorAll('.voice-card-meta').forEach(el => {
        el.textContent = tr(
            'voice.card_meta_click_to_use',
            lang === 'zh' ? '点击使用' : 'Click to use'
        );
    });

    // Re-apply current model status text according to new language
    refreshTranslatedStatus();
    if (state.isGenerating && elements.progressText) {
        elements.progressText.textContent = translateSynthStage(state.genProgress.stage);
        if (elements.genElapsedLive && state.genProgress.startedAt) {
            const elapsed = state.genProgress.frozenSec != null
                ? state.genProgress.frozenSec
                : (performance.now() - state.genProgress.startedAt) / 1000;
            elements.genElapsedLive.textContent = formatGenElapsed(elapsed, false);
        }
    }
    if (!state.isGenerating && state.lastGenSeconds != null && elements.genElapsed) {
        elements.genElapsed.textContent = formatGenElapsed(state.lastGenSeconds, true);
    }

    // Re-apply API connection badge according to new language & state
    if (elements.apiStatus) {
        if (elements.apiStatus.classList.contains('online')) {
            elements.apiStatus.textContent = tr('status.connected', 'Connected');
        } else if (elements.apiStatus.classList.contains('offline')) {
            elements.apiStatus.textContent = tr('status.starting_short', 'Starting...');
        }
    }

    if (state.lastApiStatus) {
        updateModelControlUI(state.lastApiStatus);
        updateVramDisplay(state.lastApiStatus);
    }

    updateCharTokenDisplay();

    // Re-apply runtime mode text on language switch
    if (elements.runtimeMode && elements.runtimeMode.textContent) {
        // Trigger a status refresh to update mode text with correct language
        checkApiStatus().catch(() => { });
    }

    // Force refresh default option labels in dynamic voice selectors
    const defaultVoiceText = tr('select.default', '-- Select a voice --');
    if (elements.voiceSelect?.options?.length > 0 && elements.voiceSelect.options[0].value === '') {
        elements.voiceSelect.options[0].textContent = defaultVoiceText;
    }
    if (elements.emotionSelect?.options?.length > 0 && elements.emotionSelect.options[0].value === '') {
        elements.emotionSelect.options[0].textContent = defaultVoiceText;
    }

    // Keep runtime button label aligned with release/dev behavior after language switch.
    if (elements.btnWizardRepairRuntime) {
        elements.btnWizardRepairRuntime.textContent = state.isPackaged
            ? tr('wizard.verify_runtime', lang === 'zh' ? '校验运行时' : 'Verify Runtime')
            : tr('wizard.repair_runtime', lang === 'zh' ? '修复运行时' : 'Repair Runtime');
    }

    // Updates that might be dynamic
    if (elements.statusText && elements.statusText.textContent === 'Connection Error') {
        // Re-apply dynamic status messages if they match known keys? Maybe too complex.
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
