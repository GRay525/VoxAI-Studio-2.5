/**
 * VoxAI Studio - Preload Script
 * =================================
 * Secure context bridge between main and renderer processes.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    quit: () => ipcRenderer.send('app-quit'),
    reloadWindow: () => ipcRenderer.send('window-reload'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

    // Theme
    getTheme: () => ipcRenderer.invoke('get-theme'),
    setTheme: (theme) => ipcRenderer.send('set-theme', theme),

    // API configuration
    getApiConfig: () => ipcRenderer.invoke('get-api-config'),
    getRuntimeStatus: () => ipcRenderer.invoke('get-runtime-status'),
    pickModelDir: () => ipcRenderer.invoke('pick-model-dir'),
    saveModelDir: (modelDir) => ipcRenderer.invoke('save-model-dir', modelDir),
    runtimeRepair: () => ipcRenderer.invoke('runtime-repair'),
    selfHealBackend: () => ipcRenderer.invoke('self-heal-backend'),
    exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),
    saveAudio: (payload) => ipcRenderer.invoke('save-audio', payload),

    // Language sync with main process (tray, etc.)
    setLang: (lang) => ipcRenderer.send('set-lang', lang),
    getLang: () => ipcRenderer.invoke('get-lang'),

    // Tray status texts
    setTrayBackendStatus: (label) => ipcRenderer.send('tray-backend-status', label),
    setTrayModeStatus: (label) => ipcRenderer.send('tray-mode-status', label),
    setTrayStatus: (status) => ipcRenderer.send('tray-status', status),

    // External links
    openExternal: (url) => ipcRenderer.send('open-external', url),
    openWaveformWindow: (url) => ipcRenderer.send('open-waveform-window', url),

    // Event listeners
    onQuickSynthesize: (callback) => {
        ipcRenderer.on('quick-synthesize', callback);
    },
    onPasteAndSynthesize: (callback) => {
        ipcRenderer.on('paste-and-synthesize', callback);
    },
    onOpenSettings: (callback) => {
        ipcRenderer.on('open-settings', callback);
    },

    // Remove listeners
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    }
});

// Platform info
contextBridge.exposeInMainWorld('platform', {
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux'
});
