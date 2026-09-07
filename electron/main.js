/**
 * VoxAI-Studio - Electron Main Process
 * ========================================
 * Handles window creation, system tray, global hotkeys, and backend management.
 */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeTheme, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

// Configuration
const CONFIG = {
    API_HOST: '127.0.0.1',
    API_PORT: 8000,
    WINDOW_WIDTH: 1200,
    WINDOW_HEIGHT: 800,
    MIN_WIDTH: 900,
    MIN_HEIGHT: 600,
};

let mainWindow = null;
let tray = null;
let backendProcess = null;
let currentLang = 'en'; // 'en' or 'zh', synced from renderer
let trayMenu = null;
let trayPollTimer = null;
let trayPollInFlight = false;
let trayStatus = {
    backend: 'unknown', // unknown | starting | connected | offline
    mode: 'unknown',    // unknown | cpu | gpu
    vram: null
};
let mainUiLoadTriggered = false;
const APP_CONFIG_NAME = 'voxai_config.json';

function getAppConfigPath() {
    return path.join(app.getPath('userData'), APP_CONFIG_NAME);
}

function readAppConfig() {
    try {
        const p = getAppConfigPath();
        if (!fs.existsSync(p)) {
            return {};
        }
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        console.warn('[Config] Failed to read app config:', e.message);
        return {};
    }
}

function writeAppConfig(nextConfig) {
    try {
        const p = getAppConfigPath();
        fs.writeFileSync(p, JSON.stringify(nextConfig, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.warn('[Config] Failed to write app config:', e.message);
        return false;
    }
}

function getConfiguredModelDir() {
    const cfg = readAppConfig();
    if (cfg && typeof cfg.modelDir === 'string' && cfg.modelDir.trim().length > 0) {
        return cfg.modelDir.trim();
    }
    return '';
}

function setConfiguredModelDir(modelDir) {
    const cfg = readAppConfig();
    cfg.modelDir = modelDir;
    return writeAppConfig(cfg);
}

function resolveBackendRoot() {
    const exeDir = path.dirname(process.execPath);
    const candidates = app.isPackaged
        ? [
            path.join(process.resourcesPath, 'backend'),
            path.join(exeDir, 'backend'),
            path.resolve(exeDir, '..', '..'),
            path.resolve(exeDir, '..')
        ]
        : [path.join(__dirname, '..')];

    for (const dir of candidates) {
        if (fs.existsSync(path.join(dir, 'api_server.py'))) {
            return dir;
        }
    }
    return candidates[0];
}

function resolveModelDir(backendRoot) {
    const exeDir = path.dirname(process.execPath);
    const configuredModelDir = getConfiguredModelDir();
    const candidates = app.isPackaged
        ? [
            configuredModelDir,
            path.join(exeDir, 'checkpoints'),
            path.resolve(exeDir, '..', '..', 'checkpoints'),
            path.join(backendRoot, 'checkpoints')
        ]
        : [configuredModelDir, path.join(backendRoot, 'checkpoints')];

    for (const dir of candidates) {
        if (!dir) continue;
        if (fs.existsSync(path.join(dir, 'config.yaml'))) {
            return dir;
        }
    }
    return candidates.find(Boolean) || '';
}

function ensureDirSafe(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    } catch (e) {
        console.warn('[Backend] Failed to ensure dir:', dirPath, e.message);
    }
}

function commandExists(command) {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(probe, [command], { windowsHide: true });
    return result.status === 0;
}

function getPreferredPythonExecutable(backendRoot) {
    const isWindows = process.platform === 'win32';
    const runtimePaths = getRuntimePaths(backendRoot);
    const venvPython = isWindows
        ? path.join(backendRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(backendRoot, '.venv', 'bin', 'python');

    if (fs.existsSync(runtimePaths.scriptsPython)) return runtimePaths.scriptsPython;
    if (fs.existsSync(runtimePaths.python)) return runtimePaths.python;
    if (fs.existsSync(venvPython)) return venvPython;
    if (commandExists('python')) return 'python';
    if (commandExists('python3')) return 'python3';
    return '';
}

function getRuntimePaths(backendRoot) {
    const isWindows = process.platform === 'win32';
    return {
        python: isWindows
            ? path.join(backendRoot, 'runtime', 'python.exe')
            : path.join(backendRoot, 'runtime', 'bin', 'python'),
        scriptsPython: isWindows
            ? path.join(backendRoot, 'runtime', 'Scripts', 'python.exe')
            : path.join(backendRoot, 'runtime', 'bin', 'python'),
        sitePackages: path.join(backendRoot, 'runtime', 'site-packages'),
        manifest: path.join(backendRoot, 'runtime', 'runtime_manifest.json'),
    };
}

function getSpawnEnvForRuntime(backendRoot) {
    const runtimePaths = getRuntimePaths(backendRoot);
    const base = { ...process.env };
    const pyPaths = [];
    if (runtimePaths.sitePackages && fs.existsSync(runtimePaths.sitePackages)) {
        pyPaths.push(runtimePaths.sitePackages);
    }
    if (base.PYTHONPATH) {
        pyPaths.push(base.PYTHONPATH);
    }
    if (pyPaths.length > 0) {
        base.PYTHONPATH = pyPaths.join(path.delimiter);
    }
    return base;
}

function verifyBundledRuntime(backendRoot) {
    const runtimePaths = getRuntimePaths(backendRoot);
    const pythonCandidates = [runtimePaths.scriptsPython, runtimePaths.python];
    const pythonExec = pythonCandidates.find(p => fs.existsSync(p));
    if (!pythonExec) {
        return { success: false, message: 'Bundled runtime python.exe is missing.' };
    }
    if (!fs.existsSync(runtimePaths.sitePackages)) {
        return { success: false, message: 'Bundled runtime site-packages is missing.' };
    }

    const check = spawnSync(
        pythonExec,
        ['-c', 'import fastapi,uvicorn,librosa,torch; print("ok")'],
        {
            cwd: backendRoot,
            env: getSpawnEnvForRuntime(backendRoot),
            windowsHide: true,
            encoding: 'utf8',
        }
    );

    if (check.status !== 0) {
        return {
            success: false,
            message: (check.stderr || check.stdout || 'Bundled runtime import check failed.').trim(),
        };
    }
    return { success: true, message: 'Bundled runtime is healthy.' };
}

function getRequirementsPath(backendRoot) {
    const runtimeReq = path.join(backendRoot, 'requirements.runtime.txt');
    if (fs.existsSync(runtimeReq)) return runtimeReq;
    const stdReq = path.join(backendRoot, 'requirements.txt');
    if (fs.existsSync(stdReq)) return stdReq;
    return '';
}

function getRuntimeStatus() {
    const backendRoot = resolveBackendRoot();
    const modelDir = resolveModelDir(backendRoot);
    const pythonExec = getPreferredPythonExecutable(backendRoot);
    const requirementsPath = getRequirementsPath(backendRoot);
    const runtimePaths = getRuntimePaths(backendRoot);
    const runtimePath = fs.existsSync(runtimePaths.scriptsPython) ? runtimePaths.scriptsPython : runtimePaths.python;
    const venvPython = process.platform === 'win32'
        ? path.join(backendRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(backendRoot, '.venv', 'bin', 'python');
    const runtimeHealth = app.isPackaged ? verifyBundledRuntime(backendRoot) : { success: true, message: 'skip' };

    return {
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        backendRoot,
        modelDir,
        configuredModelDir: getConfiguredModelDir(),
        scriptExists: fs.existsSync(path.join(backendRoot, 'api_server.py')),
        hasRuntimePython: fs.existsSync(runtimePath),
        runtimeSitePackagesFound: fs.existsSync(runtimePaths.sitePackages),
        runtimeManifestFound: fs.existsSync(runtimePaths.manifest),
        hasVenvPython: fs.existsSync(venvPython),
        pythonExec,
        requirementsPath,
        bundledRuntimeHealthy: runtimeHealth.success,
        bundledRuntimeMessage: runtimeHealth.message,
        modelConfigFound: !!modelDir && fs.existsSync(path.join(modelDir, 'config.yaml')),
        modelVocabFound: !!modelDir && (
            fs.existsSync(path.join(modelDir, 'multilingual_zh_ja_yue_char_del.tiktoken')) ||
            fs.existsSync(path.join(modelDir, 'gpt.pth'))
        ),
        hasBackendProcess: !!backendProcess,
    };
}

function loadMainInterface() {
    if (!mainWindow || mainUiLoadTriggered) return;
    mainUiLoadTriggered = true;

    // Load the full app after the lightweight shell is visible
    mainWindow.loadFile(path.join(__dirname, 'src/index.html')).catch((err) => {
        console.error('[Window] Failed to load main UI:', err);
    });
}

// ============================================
// Single Instance Lock
// ============================================
// Prevent multiple instances of the app from running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // Another instance is already running
    console.log('[App] Another instance is already running. Exiting...');
    app.quit();
} else {
    // Handle second instance attempt
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('[App] Second instance detected, focusing existing window');
        // Someone tried to run a second instance, focus our window instead
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function reloadCurrentPage() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    // Match Chromium Ctrl+R in DevTools: bypass cache so HTML/CSS/JS changes show up.
    mainWindow.webContents.reloadIgnoringCache();
}

/**
 * Create the main application window
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: CONFIG.WINDOW_WIDTH,
        height: CONFIG.WINDOW_HEIGHT,
        minWidth: CONFIG.MIN_WIDTH,
        minHeight: CONFIG.MIN_HEIGHT,
        frame: false, // Frameless window for custom title bar
        transparent: false,
        backgroundColor: '#0f172a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        icon: path.join(__dirname, 'src/assets/icons/icon.png'),
        show: false, // Show when ready
    });

    // Load a lightweight shell immediately for fast first paint
    mainWindow.loadFile(path.join(__dirname, 'src/loading.html')).catch((err) => {
        console.error('[Window] Failed to load shell UI:', err);
    });

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        loadMainInterface();
    });

    // Ctrl+R / F5 refresh the page; Ctrl+Shift+I toggles DevTools
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') {
            return;
        }

        const key = (input.key || '').toLowerCase();
        const ctrl = input.control || input.meta;

        if (ctrl && input.shift && !input.alt && key === 'i') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
            return;
        }

        if (key === 'f5' || (ctrl && !input.alt && key === 'r')) {
            reloadCurrentPage();
            event.preventDefault();
        }
    });

    // Handle window close - minimize to tray instead
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
        return true;
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        mainUiLoadTriggered = false;
    });
}

function formatTrayGb(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '--';
    }
    return Number(value).toFixed(2);
}

function formatTrayVram(data) {
    if (!data) return null;
    const appGb = data.vram_app_gb;
    const usedGb = data.vram_used_gb;
    const totalGb = data.vram_total_gb;
    if (appGb == null && usedGb == null && totalGb == null) {
        return null;
    }
    return `${formatTrayGb(appGb)} / ${formatTrayGb(usedGb)} / ${formatTrayGb(totalGb)} GB`;
}

function applyTrayMenu() {
    if (!tray) return;
    const labels = getTrayLabels();
    tray.setToolTip(labels.tooltip);
    tray.setContextMenu(buildTrayMenu());
}

function applyStructuredTrayStatus(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.backend) trayStatus.backend = payload.backend;
    if (payload.mode) trayStatus.mode = payload.mode;
    if (Object.prototype.hasOwnProperty.call(payload, 'vram')) {
        trayStatus.vram = payload.vram || null;
    }
    applyTrayMenu();
}

function applyTrayStatusFromApi(data, connected) {
    if (!connected) {
        trayStatus.backend = backendProcess ? 'starting' : 'offline';
        if (!backendProcess) {
            trayStatus.mode = 'unknown';
            trayStatus.vram = null;
        }
        applyTrayMenu();
        return;
    }

    trayStatus.backend = 'connected';
    const device = String(data?.device || '').toLowerCase();
    if (device.includes('cuda') || data?.cuda_available) {
        trayStatus.mode = 'gpu';
        trayStatus.vram = formatTrayVram(data);
    } else if (device.includes('cpu') || (data?.model_loaded && !data?.cuda_available)) {
        trayStatus.mode = 'cpu';
        trayStatus.vram = null;
    } else {
        trayStatus.mode = 'unknown';
        trayStatus.vram = formatTrayVram(data);
    }
    applyTrayMenu();
}

async function pollTrayBackendStatus() {
    if (trayPollInFlight) return;
    trayPollInFlight = true;
    try {
        const res = await fetch(`http://${CONFIG.API_HOST}:${CONFIG.API_PORT}/api/status`, {
            signal: AbortSignal.timeout(2500)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        applyTrayStatusFromApi(data, true);
    } catch (e) {
        applyTrayStatusFromApi(null, false);
    } finally {
        trayPollInFlight = false;
    }
}

function startTrayStatusPolling() {
    if (trayPollTimer) return;
    pollTrayBackendStatus();
    trayPollTimer = setInterval(pollTrayBackendStatus, 2000);
}

function stopTrayStatusPolling() {
    if (trayPollTimer) {
        clearInterval(trayPollTimer);
        trayPollTimer = null;
    }
}

/**
 * Get localized tray labels based on currentLang
 */
function getTrayLabels() {
    const zh = currentLang === 'zh';
    const backendMap = {
        unknown: zh ? '后端：状态未知' : 'Backend: unknown',
        starting: zh ? '后端：启动中…' : 'Backend: starting…',
        connected: zh ? '后端：已连接' : 'Backend: connected',
        offline: zh ? '后端：离线' : 'Backend: offline'
    };
    let modeStatus;
    if (trayStatus.mode === 'gpu') {
        modeStatus = trayStatus.vram
            ? (zh ? `模式：GPU（${trayStatus.vram}）` : `Mode: GPU (${trayStatus.vram})`)
            : (zh ? '模式：GPU' : 'Mode: GPU');
    } else if (trayStatus.mode === 'cpu') {
        modeStatus = zh ? '模式：CPU' : 'Mode: CPU';
    } else {
        modeStatus = zh ? '模式：--' : 'Mode: --';
    }
    if (zh) {
        return {
            show: '打开 VoxAI Studio',
            minimize: '最小化',
            apiStatus: backendMap[trayStatus.backend] || backendMap.unknown,
            modeStatus,
            quit: '完全退出',
            tooltip: 'VoxAI Studio'
        };
    }
    return {
        show: 'Open VoxAI Studio',
        minimize: 'Minimize',
        apiStatus: backendMap[trayStatus.backend] || backendMap.unknown,
        modeStatus,
        quit: 'Quit Completely',
        tooltip: 'VoxAI Studio'
    };
}

/**
 * Build tray menu template using current language
 */
function buildTrayMenu() {
    const labels = getTrayLabels();
    const menu = Menu.buildFromTemplate([
        {
            label: labels.show,
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: labels.minimize,
            click: () => {
                if (mainWindow) {
                    mainWindow.hide();
                }
            }
        },
        { type: 'separator' },
        {
            label: labels.apiStatus,
            enabled: false,
            id: 'api-status'
        },
        {
            label: labels.modeStatus,
            enabled: false,
            id: 'mode-status'
        },
        { type: 'separator' },
        {
            label: labels.quit,
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    trayMenu = menu;
    return menu;
}

/**
 * Update tray menu/tooltips when language changes
 */
function refreshTrayLanguage() {
    applyTrayMenu();
}

/**
 * Create system tray icon and menu
 */
function createTray() {
    const iconPath = path.join(__dirname, 'src/assets/icons/tray.png');

    try {
        tray = new Tray(iconPath);
    } catch (e) {
        // Fallback if icon not found
        console.log('Tray icon not found, using default');
        return;
    }

    refreshTrayLanguage();
    if (backendProcess) {
        trayStatus.backend = 'starting';
        applyTrayMenu();
    }
    startTrayStatusPolling();

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

/**
 * Register global keyboard shortcuts
 */
function registerGlobalShortcuts() {
    // Ctrl+Shift+S - Quick synthesize
    globalShortcut.register('CommandOrControl+Shift+S', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('quick-synthesize');
        }
    });

    // Ctrl+Shift+V - Paste and synthesize
    globalShortcut.register('CommandOrControl+Shift+V', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('paste-and-synthesize');
        }
    });
}

/**
 * Start the Python FastAPI backend server silently
 */
function startBackend() {
    trayStatus.backend = 'starting';
    trayStatus.mode = 'unknown';
    trayStatus.vram = null;
    applyTrayMenu();

    const backendRoot = resolveBackendRoot();
    const modelDir = resolveModelDir(backendRoot);
    const scriptPath = path.join(backendRoot, 'api_server.py');
    const workDir = app.isPackaged ? path.dirname(process.execPath) : backendRoot;
    const backendLogFile = path.join(workDir, 'backend_startup.log');

    ensureDirSafe(path.join(workDir, 'outputs'));
    ensureDirSafe(path.join(workDir, 'prompts'));
    ensureDirSafe(path.join(workDir, 'checkpoints'));

    if (!fs.existsSync(scriptPath)) {
        console.error('[Backend] api_server.py not found:', scriptPath);
        return;
    }

    const MAX_RESTARTS = 3;
    let startAttempts = 0;

    function spawnServerProcess() {
        console.log('[Backend] Attempting to start API server...');
        console.log('[Backend] Backend root:', backendRoot);
        console.log('[Backend] Model dir:', modelDir);
        if (app.isPackaged) {
            try {
                fs.appendFileSync(
                    backendLogFile,
                    `[${new Date().toISOString()}] Attempting backend start. backendRoot=${backendRoot}, modelDir=${modelDir}\n`,
                    'utf8'
                );
            } catch (e) { }
        }

        const isWindows = process.platform === 'win32';

        let command;
        let args;
        const commonArgs = [scriptPath, '--host', CONFIG.API_HOST, '--port', String(CONFIG.API_PORT), '--model_dir', modelDir];
        let spawnEnv = { ...process.env };

        // Priority 1: Internal Portable Runtime (True Portable Mode)
        const runtimePaths = getRuntimePaths(backendRoot);
        const runtimePath = fs.existsSync(runtimePaths.scriptsPython) ? runtimePaths.scriptsPython : runtimePaths.python;
        const venvPython = isWindows
            ? path.join(backendRoot, '.venv', 'Scripts', 'python.exe')
            : path.join(backendRoot, '.venv', 'bin', 'python');

        if (fs.existsSync(runtimePath)) {
            console.log('[Backend] Using internal portable runtime:', runtimePath);
            command = runtimePath;
            args = commonArgs;
            spawnEnv = getSpawnEnvForRuntime(backendRoot);
        }
        // Priority 2: Local venv python
        else if (fs.existsSync(venvPython)) {
            console.log('[Backend] Using local .venv python:', venvPython);
            command = venvPython;
            args = commonArgs;
        }
        // Priority 3: uv run (dev mode only; packaged mode should avoid this branch)
        else if (!app.isPackaged && fs.existsSync(path.join(backendRoot, 'pyproject.toml'))) {
            console.log('[Backend] Using uv run python');
            command = isWindows ? 'uv.exe' : 'uv';
            args = ['run', 'python', ...commonArgs];
        }
        // Priority 4: System Python (Fallback)
        else {
            if (app.isPackaged) {
                console.error('[Backend] Packaged app runtime is missing. Refusing system Python fallback.');
                if (mainWindow && !mainWindow.isDestroyed()) {
                    dialog.showMessageBox(mainWindow, {
                        type: 'error',
                        title: 'VoxAI Studio Runtime Error',
                        message: 'Bundled runtime is missing or damaged.',
                        detail: 'Please reinstall VoxAI Studio or use "Export Diagnostics" and contact support.'
                    }).catch(() => { });
                }
                return;
            }
            console.log('[Backend] Using system python fallback');
            command = isWindows ? 'python' : 'python3';
            args = commonArgs;
        }

        try {
            backendProcess = spawn(command, args, {
                cwd: workDir,
                detached: false,
                windowsHide: true,
                env: spawnEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            backendProcess.stdout.on('data', (data) => {
                const text = data.toString().trim();
                console.log(`[Backend] ${text}`);
                if (app.isPackaged) {
                    try {
                        fs.appendFileSync(backendLogFile, `[${new Date().toISOString()}] [STDOUT] ${text}\n`, 'utf8');
                    } catch (e) { }
                }
            });

            backendProcess.stderr.on('data', (data) => {
                // Uvicorn and many libraries log INFO/WARNING to stderr by default,
                // so we treat this as a generic backend log instead of an error.
                const text = data.toString().trim();
                console.log(`[Backend Log] ${text}`);
                if (app.isPackaged) {
                    try {
                        fs.appendFileSync(backendLogFile, `[${new Date().toISOString()}] [STDERR] ${text}\n`, 'utf8');
                    } catch (e) { }
                }
            });

            backendProcess.on('error', (err) => {
                console.error('[Backend] Failed to start:', err.message);
                if (app.isPackaged) {
                    try {
                        fs.appendFileSync(backendLogFile, `[${new Date().toISOString()}] [ERROR] Failed to start: ${err.message}\n`, 'utf8');
                    } catch (e) { }
                }
                // In packaged builds, never fallback to system Python.
                if (!app.isPackaged) {
                    tryDirectPython(backendRoot, workDir, scriptPath, modelDir);
                }
            });

            backendProcess.on('exit', (code) => {
                console.log(`[Backend] Process exited with code ${code}`);
                if (app.isPackaged) {
                    try {
                        fs.appendFileSync(backendLogFile, `[${new Date().toISOString()}] [EXIT] code=${code}\n`, 'utf8');
                    } catch (e) { }
                }
                backendProcess = null;

                // If exited with error (code 1 usually means port in use)
                if (code !== 0 && code !== null) {
                    console.log('[Backend] Process exited with error. Checking if server is already running...');

                    // First check if a server is ALREADY responding on the port
                    checkServerHealth((isRunning) => {
                        if (isRunning) {
                            console.log('[Backend] ✓ Server is already running on port ' + CONFIG.API_PORT + '. Using existing instance.');
                            // Server is running, no need to restart
                            return;
                        }

                        // Server not responding - might be a real crash, try restart
                        if (startAttempts < MAX_RESTARTS) {
                            startAttempts++;
                            console.log(`[Backend] Server not responding. Restarting... (Attempt ${startAttempts}/${MAX_RESTARTS})`);
                            setTimeout(spawnServerProcess, 2000);
                        } else {
                            console.error('[Backend] Failed to start server after multiple attempts.');
                        }
                    });
                }
            });

            console.log('[Backend] Server process started (PID:', backendProcess.pid, ')');
        } catch (err) {
            console.error('[Backend] Spawn failed:', err.message);
            if (!app.isPackaged) {
                tryDirectPython(backendRoot, workDir, scriptPath, modelDir);
            }
        }
    }

    // Check if server is already running
    checkServerHealth((isRunning) => {
        if (isRunning) {
            console.log('[Backend] Server already running');
            return;
        }

        // Server not running, start it
        spawnServerProcess();
    });
}

/**
 * Check server health status
 */
function checkServerHealth(callback) {
    const http = require('http');
    const checkUrl = `http://${CONFIG.API_HOST}:${CONFIG.API_PORT}/health`;

    // Set a short timeout for the check
    const req = http.get(checkUrl, (res) => {
        if (res.statusCode === 200) {
            callback(true);
        } else {
            callback(false);
        }
        // Consume response data to free memory
        res.resume();
    });

    req.on('error', () => {
        callback(false);
    });

    req.setTimeout(1000, () => {
        req.destroy();
        callback(false);
    });
}

function tryReleaseApiPort() {
    if (process.platform !== 'win32') return { released: false, message: 'skip' };
    try {
        const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
        if (out.status !== 0 || !out.stdout) {
            return { released: false, message: 'netstat failed' };
        }
        const lines = out.stdout.split(/\r?\n/);
        const target = `:${CONFIG.API_PORT}`;
        const pids = new Set();
        for (const line of lines) {
            if (!line.includes(target) || !line.toUpperCase().includes('LISTENING')) continue;
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid)) pids.add(pid);
        }
        let released = false;
        pids.forEach((pid) => {
            if (backendProcess && String(backendProcess.pid) === String(pid)) return;
            spawnSync('taskkill', ['/PID', pid, '/F', '/T'], { windowsHide: true });
            released = true;
        });
        return { released, message: released ? 'port owner killed' : 'no external owner' };
    } catch (e) {
        return { released: false, message: e.message };
    }
}

/**
 * Poll for server availability
 */
function waitForServer(retries, callback) {
    if (retries <= 0) {
        callback(false);
        return;
    }

    checkServerHealth((isRunning) => {
        if (isRunning) {
            callback(true);
        } else {
            console.log(`[Backend] Retrying connection... (${retries} attempts left)`);
            setTimeout(() => {
                waitForServer(retries - 1, callback);
            }, 1000);
        }
    });
}

/**
 * Fallback: Try direct Python if uv fails
 */
function tryDirectPython(backendRoot, workDir, scriptPath, modelDir) {
    console.log('[Backend] Trying direct Python...');

    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const args = [scriptPath, '--host', CONFIG.API_HOST, '--port', String(CONFIG.API_PORT), '--model_dir', modelDir];

    try {
        backendProcess = spawn(pythonCmd, args, {
            cwd: workDir || backendRoot,
            detached: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        backendProcess.stdout.on('data', (data) => {
            console.log(`[Backend] ${data.toString().trim()}`);
        });
        backendProcess.stderr.on('data', (data) => {
            console.log(`[Backend Log] ${data.toString().trim()}`);
        });

        backendProcess.on('error', (err) => {
            console.error('[Backend] Python also failed:', err.message);
        });

        console.log('[Backend] Python server started (PID:', backendProcess.pid, ')');
    } catch (err) {
        console.error('[Backend] All methods failed:', err.message);
    }
}

function runRuntimeRepairTask() {
    return new Promise((resolve) => {
        const backendRoot = resolveBackendRoot();

        // Release mode behavior: verify bundled runtime and advise reinstall.
        if (app.isPackaged) {
            const result = verifyBundledRuntime(backendRoot);
            if (result.success) {
                resolve({ success: true, message: 'Bundled runtime check passed.', logs: '' });
            } else {
                resolve({
                    success: false,
                    message: `Bundled runtime check failed: ${result.message}. Please reinstall VoxAI Studio.`,
                    logs: '',
                    requiresReinstall: true
                });
            }
            return;
        }

        const pythonExec = getPreferredPythonExecutable(backendRoot);
        const requirementsPath = getRequirementsPath(backendRoot);
        const logChunks = [];

        if (!pythonExec) {
            resolve({ success: false, message: 'No usable Python runtime found.', logs: '' });
            return;
        }
        if (!requirementsPath) {
            resolve({ success: false, message: 'requirements file not found.', logs: '' });
            return;
        }

        const proc = spawn(
            pythonExec,
            ['-m', 'pip', 'install', '--no-cache-dir', '-r', requirementsPath],
            {
                cwd: backendRoot,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );

        proc.stdout.on('data', (d) => logChunks.push(d.toString()));
        proc.stderr.on('data', (d) => logChunks.push(d.toString()));
        proc.on('error', (err) => {
            resolve({ success: false, message: err.message, logs: logChunks.join('') });
        });
        proc.on('exit', (code) => {
            resolve({
                success: code === 0,
                message: code === 0 ? 'Runtime repair completed.' : `Runtime repair failed with code ${code}.`,
                logs: logChunks.join(''),
            });
        });
    });
}

function exportDiagnosticsBundle() {
    return new Promise((resolve) => {
        try {
            const userData = app.getPath('userData');
            const logsDir = path.join(userData, 'logs');
            ensureDirSafe(logsDir);

            const tempDir = path.join(logsDir, `diagnostics_${Date.now()}`);
            ensureDirSafe(tempDir);

            const runtimeStatus = getRuntimeStatus();
            fs.writeFileSync(path.join(tempDir, 'runtime_status.json'), JSON.stringify(runtimeStatus, null, 2), 'utf8');

            const backendLog = path.join(path.dirname(process.execPath), 'backend_startup.log');
            if (fs.existsSync(backendLog)) {
                fs.copyFileSync(backendLog, path.join(tempDir, 'backend_startup.log'));
            }

            const zipPath = path.join(logsDir, `diagnostics_${Date.now()}.zip`);
            const psCmd = [
                '-NoProfile',
                '-Command',
                `Compress-Archive -Path "${tempDir}\\*" -DestinationPath "${zipPath}" -Force`
            ];
            const ps = spawn('powershell', psCmd, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

            let errText = '';
            ps.stderr.on('data', (d) => { errText += d.toString(); });
            ps.on('error', (e) => {
                resolve({ success: false, message: e.message, path: '' });
            });
            ps.on('exit', (code) => {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (e) { }
                if (code === 0 && fs.existsSync(zipPath)) {
                    resolve({ success: true, message: 'Diagnostics exported.', path: zipPath });
                } else {
                    resolve({ success: false, message: errText || `Compress failed with code ${code}`, path: '' });
                }
            });
        } catch (e) {
            resolve({ success: false, message: e.message, path: '' });
        }
    });
}

/**
 * Stop the backend server gracefully
 */
async function stopBackend() {
    console.log('[Backend] Initiating graceful shutdown...');

    // First, try to shutdown via API (this cleans up VRAM)
    try {
        const http = require('http');
        const shutdownUrl = `http://${CONFIG.API_HOST}:${CONFIG.API_PORT}/api/shutdown`;

        await new Promise((resolve, reject) => {
            const req = http.request(shutdownUrl, { method: 'POST', timeout: 3000 }, (res) => {
                console.log('[Backend] Shutdown API response:', res.statusCode);
                resolve();
            });
            req.on('error', (err) => {
                console.log('[Backend] Shutdown API not reachable:', err.message);
                resolve(); // Continue even if API fails
            });
            req.on('timeout', () => {
                req.destroy();
                resolve();
            });
            req.end();
        });

        // Wait for graceful shutdown to complete
        console.log('[Backend] Waiting for graceful shutdown...');
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
        console.log('[Backend] Graceful shutdown request failed:', err.message);
    }

    // Force kill if process is still running
    if (backendProcess) {
        console.log('[Backend] Force stopping remaining process...');

        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t'], {
                windowsHide: true
            });
        } else {
            backendProcess.kill('SIGTERM');
        }

        backendProcess = null;
    }

    trayStatus.backend = 'offline';
    trayStatus.mode = 'unknown';
    trayStatus.vram = null;
    applyTrayMenu();
    console.log('[Backend] Server stopped');
}


/**
 * IPC Handlers for renderer communication
 */
function setupIpcHandlers() {
    // Window controls
    ipcMain.on('window-minimize', () => {
        if (mainWindow) mainWindow.minimize();
    });

    ipcMain.on('window-maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipcMain.on('window-close', () => {
        if (mainWindow) mainWindow.close();
    });

    ipcMain.on('app-quit', () => {
        app.isQuitting = true;
        app.quit();
    });

    ipcMain.on('window-reload', () => {
        reloadCurrentPage();
    });

    // Get window state
    ipcMain.handle('window-is-maximized', () => {
        return mainWindow ? mainWindow.isMaximized() : false;
    });

    // Theme handling
    ipcMain.handle('get-theme', () => {
        return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    });

    ipcMain.on('set-theme', (event, theme) => {
        nativeTheme.themeSource = theme; // 'dark', 'light', or 'system'
    });

    // Open external links
    ipcMain.on('open-external', (event, url) => {
        shell.openExternal(url);
    });

    // Get API config
    ipcMain.handle('get-api-config', () => {
        return {
            host: CONFIG.API_HOST,
            port: CONFIG.API_PORT,
            baseUrl: `http://${CONFIG.API_HOST}:${CONFIG.API_PORT}`
        };
    });

    // Runtime manager helpers for first-run experience
    ipcMain.handle('get-runtime-status', () => {
        return getRuntimeStatus();
    });

    ipcMain.handle('pick-model-dir', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Select model directory (checkpoints)',
        });
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { success: false, canceled: true, path: '' };
        }
        const selected = result.filePaths[0];
        setConfiguredModelDir(selected);
        return { success: true, canceled: false, path: selected };
    });

    ipcMain.handle('save-model-dir', (event, modelDir) => {
        if (!modelDir || typeof modelDir !== 'string') {
            return { success: false, message: 'Invalid model directory.' };
        }
        const ok = setConfiguredModelDir(modelDir);
        return { success: ok, message: ok ? 'Saved' : 'Failed to save' };
    });

    ipcMain.handle('runtime-repair', async () => {
        return await runRuntimeRepairTask();
    });

    ipcMain.handle('self-heal-backend', async () => {
        try {
            const portFix = tryReleaseApiPort();
            await stopBackend();
            startBackend();
            return { success: true, message: `Backend restarted. ${portFix.message}` };
        } catch (e) {
            return { success: false, message: e.message };
        }
    });

    ipcMain.handle('export-diagnostics', async () => {
        return await exportDiagnosticsBundle();
    });

    ipcMain.handle('save-audio', async (event, payload) => {
        const url = payload && payload.url;
        const suggestedName = (payload && payload.filename) || `voxai_${Date.now()}.wav`;
        if (!url) {
            return { success: false, canceled: false, message: 'No audio URL' };
        }

        const result = await dialog.showSaveDialog(mainWindow, {
            title: currentLang === 'zh' ? '保存音频' : 'Save audio',
            defaultPath: path.join(app.getPath('documents'), suggestedName),
            filters: [
                { name: currentLang === 'zh' ? 'WAV 音频' : 'WAV audio', extensions: ['wav'] },
                { name: currentLang === 'zh' ? '所有文件' : 'All files', extensions: ['*'] },
            ],
        });
        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(result.filePath, buffer);
            return { success: true, canceled: false, path: result.filePath };
        } catch (e) {
            return { success: false, canceled: false, message: e.message };
        }
    });

    // Language sync (for tray, etc.)
    ipcMain.on('set-lang', (event, lang) => {
        if (lang === 'zh' || lang === 'en') {
            currentLang = lang;
            const cfg = readAppConfig();
            cfg.lang = lang;
            writeAppConfig(cfg);
            refreshTrayLanguage();
        }
    });

    ipcMain.handle('get-lang', () => {
        return currentLang;
    });

    // Tray dynamic status texts
    ipcMain.on('tray-status', (event, payload) => {
        applyStructuredTrayStatus(payload);
    });

    ipcMain.on('tray-backend-status', (event, label) => {
        const s = String(label || '');
        if (/已连接|connected/i.test(s)) trayStatus.backend = 'connected';
        else if (/启动|starting/i.test(s)) trayStatus.backend = 'starting';
        else if (/离线|offline/i.test(s)) trayStatus.backend = 'offline';
        else trayStatus.backend = 'unknown';
        applyTrayMenu();
    });

    ipcMain.on('tray-mode-status', (event, label) => {
        const s = String(label || '');
        if (/GPU/i.test(s)) {
            trayStatus.mode = 'gpu';
            const match = s.match(/[（(](.+?)[）)]/);
            trayStatus.vram = match ? match[1].trim() : null;
        } else if (/CPU/i.test(s)) {
            trayStatus.mode = 'cpu';
            trayStatus.vram = null;
        } else {
            trayStatus.mode = 'unknown';
            trayStatus.vram = null;
        }
        applyTrayMenu();
    });

    // Open waveform window (debug / standalone viewer)
    ipcMain.on('open-waveform-window', (event, audioUrl) => {
        createWaveformWindow(audioUrl);
    });
}

/**
 * Create a standalone waveform window
 * (used only for debug / separate waveform testing)
 */
function createWaveformWindow(audioUrl) {
    const win = new BrowserWindow({
        width: 1000,
        height: 400,
        minWidth: 600,
        minHeight: 300,
        frame: false,
        backgroundColor: '#0f172a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        icon: path.join(__dirname, 'src/assets/icons/icon.png'),
        show: false
    });

    // Pass audio URL as query parameter
    const loadUrl = `file://${path.join(__dirname, 'src/waveform.html')}?audio=${encodeURIComponent(audioUrl)}`;
    win.loadURL(loadUrl);

    win.once('ready-to-show', () => {
        win.show();
    });
}

// App lifecycle
app.whenReady().then(() => {
    // Only proceed if we got the single instance lock
    if (!gotTheLock) return;

    const savedLang = readAppConfig().lang;
    if (savedLang === 'zh' || savedLang === 'en') {
        currentLang = savedLang;
    }

    setupIpcHandlers();
    createWindow();
    startBackend();
    createTray();
    registerGlobalShortcuts();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // Unregister all shortcuts
    globalShortcut.unregisterAll();
    stopTrayStatusPolling();

    // Stop backend server
    stopBackend();
});

app.on('before-quit', () => {
    app.isQuitting = true;
});
