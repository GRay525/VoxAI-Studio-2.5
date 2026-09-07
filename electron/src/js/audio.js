/**
 * VoxAI Studio - Audio Utilities
 * ===================================
 * Audio playback, waveform visualization, and file handling
 */

class AudioManager {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.currentSource = null;
        this.animationId = null;
    }

    /**
     * Initialize audio context (must be called after user interaction)
     */
    initContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.connect(this.audioContext.destination);
        }
        return this.audioContext;
    }

    /**
     * Draw waveform visualization
     * Render as a classic centered waveform that is easy to read.
     */
    drawWaveform(canvas, audioBuffer) {
        try {
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.warn('Could not get 2D context for waveform canvas');
                return;
            }

            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            const containerWidth = rect.width || 300;
            const containerHeight = rect.height || 120;

            const width = canvas.width = containerWidth * dpr;
            const height = canvas.height = containerHeight * dpr;

            if (!audioBuffer || width <= 0 || height <= 0) {
                ctx.clearRect(0, 0, width, height);
                return;
            }

            const data = audioBuffer.getChannelData(0);
            const centerY = height / 2;

            ctx.clearRect(0, 0, width, height);

            // Draw center baseline
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
            ctx.lineWidth = 1 * dpr;
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            ctx.lineTo(width, centerY);
            ctx.stroke();

            // Number of vertical samples (columns)
            const columnCount = Math.min(width, 800); // cap for performance
            const samplesPerColumn = Math.floor(data.length / columnCount);
            const maxAmplitude = height * 0.4; // 80% of half height

            // Gradient for waveform line
            const gradient = ctx.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, '#6366f1');
            gradient.addColorStop(0.5, '#8b5cf6');
            gradient.addColorStop(1, '#6366f1');
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1.5 * dpr;
            ctx.beginPath();

            for (let i = 0; i < columnCount; i++) {
                const start = i * samplesPerColumn;
                const end = Math.min(start + samplesPerColumn, data.length);
                if (start >= end) break;

                let min = 1.0;
                let max = -1.0;
                for (let j = start; j < end; j++) {
                    const v = data[j];
                    if (v < min) min = v;
                    if (v > max) max = v;
                }

                const x = (i / (columnCount - 1)) * width;
                const yTop = centerY - max * maxAmplitude;
                const yBottom = centerY - min * maxAmplitude;

                ctx.moveTo(x, yTop);
                ctx.lineTo(x, yBottom);
            }

            ctx.stroke();
        } catch (error) {
            console.error('Error drawing waveform:', error);
        }
    }

    /**
     * Simple test pattern renderer for debugging canvas sizing.
     */
    drawTestPattern(canvas) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width = (rect.width || 800) * dpr;
        const height = canvas.height = (rect.height || 200) * dpr;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1;
        for (let x = 0; x < width; x += 40 * dpr) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += 40 * dpr) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw a sine wave across the canvas
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        const amplitude = height * 0.3;
        const midY = height / 2;
        for (let x = 0; x < width; x++) {
            const t = (x / width) * Math.PI * 4;
            const y = midY + Math.sin(t) * amplitude;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    /**
     * Draw real-time frequency visualization
     */
    drawFrequencies(canvas) {
        if (!this.analyser) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
        const height = canvas.height = canvas.offsetHeight * window.devicePixelRatio;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            this.animationId = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);

            ctx.fillStyle = 'rgba(10, 10, 15, 0.3)';
            ctx.fillRect(0, 0, width, height);

            const barWidth = (width / bufferLength) * 2.5;
            let x = 0;

            // Gradient for bars
            const gradient = ctx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, '#6366f1');
            gradient.addColorStop(1, '#8b5cf6');
            ctx.fillStyle = gradient;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * height;
                ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
                x += barWidth + 1;
            }
        };

        draw();
    }

    /**
     * Stop frequency animation
     */
    stopFrequencies() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Load and decode audio file
     */
    async loadAudioFile(file) {
        this.initContext();
        const arrayBuffer = await file.arrayBuffer();
        return this.audioContext.decodeAudioData(arrayBuffer);
    }

    /**
     * Load audio from URL
     */
    async loadAudioUrl(url) {
        try {
            this.initContext();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            return await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error('Error loading audio from URL:', error);
            throw error; // Re-throw so caller can handle it
        }
    }

    /**
     * Format time in MM:SS
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Export singleton
window.audioManager = new AudioManager();
