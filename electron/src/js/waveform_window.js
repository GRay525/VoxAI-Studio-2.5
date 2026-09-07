/**
 * VoxAI Studio - Waveform Window Script
 * =========================================
 * Handles the standalone waveform visualization window
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Basic window controls
    document.getElementById('btnClose')?.addEventListener('click', () => {
        window.close();
    });

    // Apply theme
    if (window.electronAPI) {
        const theme = await window.electronAPI.getTheme();
        document.documentElement.dataset.theme = theme;
    }

    // Get audio URL from query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const audioUrl = urlParams.get('audio');

    if (!audioUrl) {
        document.getElementById('loadingText').textContent = 'No audio specified';
        return;
    }

    const canvas = document.getElementById('waveformCanvas');
    const loadingText = document.getElementById('loadingText');

    // First, draw a synthetic test pattern so we can visually confirm that
    // the canvas sizing and rendering pipeline are correct.
    try {
        window.audioManager.drawTestPattern(canvas);
    } catch (e) {
        console.error('Failed to draw test pattern:', e);
    }

    try {
        // Initialize audio manager
        // Note: We might need to handle the path correctly if it's relative
        let fullUrl = audioUrl;

        // If it's a relative path starting with /outputs, we need the base API URL
        if (audioUrl.startsWith('/')) {
            const config = await window.electronAPI.getApiConfig();
            fullUrl = `${config.baseUrl}${audioUrl}`;
        }

        console.log('Loading audio from:', fullUrl);

        // Load audio buffer
        const audioBuffer = await window.audioManager.loadAudioUrl(fullUrl);

        // Loading完成后直接移除覆盖文字，避免再次遮挡波形
        if (loadingText && loadingText.parentElement) {
            loadingText.parentElement.removeChild(loadingText);
        }

        // 画真实波形（覆盖掉之前的测试图）
        requestAnimationFrame(() => {
            window.audioManager.drawWaveform(canvas, audioBuffer);
        });

        // Re-draw on resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                window.audioManager.drawWaveform(canvas, audioBuffer);
            }, 200);
        });

    } catch (error) {
        console.error('Failed to load audio:', error);
        loadingText.textContent = `Error: ${error.message}`;
        loadingText.style.color = 'var(--color-error)';
    }
});
