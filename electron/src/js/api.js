/**
 * VoxAI Studio - API Client
 * =============================
 * Handles communication with the FastAPI backend
 */

class VoxAIAPI {
    constructor(baseUrl = 'http://127.0.0.1:8000') {
        this.baseUrl = baseUrl;
        this.isConnected = false;
    }

    /**
     * Initialize API client and check connection
     */
    async init() {
        try {
            // Try to get config from Electron if available
            if (window.electronAPI) {
                const config = await window.electronAPI.getApiConfig();
                this.baseUrl = config.baseUrl;
            }
        } catch (e) {
            console.log('Running in standalone mode');
        }

        await this.checkConnection();
        return this;
    }

    /**
     * Check if the API server is available
     */
    async checkConnection() {
        try {
            const response = await fetch(`${this.baseUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            const data = await response.json();
            this.isConnected = data.status === 'ok';
            return { connected: this.isConnected, modelReady: data.model_ready };
        } catch (error) {
            this.isConnected = false;
            return { connected: false, modelReady: false, error: error.message };
        }
    }

    /**
     * Get system status
     */
    async getStatus() {
        const response = await fetch(`${this.baseUrl}/api/status`);
        if (!response.ok) throw new Error('Failed to get status');
        return response.json();
    }

    /**
     * List available voices
     */
    async getVoices() {
        const response = await fetch(`${this.baseUrl}/api/voices`);
        if (!response.ok) throw new Error('Failed to get voices');
        return response.json();
    }

    /**
     * Upload a voice file
     */
    async uploadVoice(file) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${this.baseUrl}/api/voices/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to upload voice');
        }
        return response.json();
    }

    /**
     * Get emotion presets
     */
    async getEmotions() {
        const response = await fetch(`${this.baseUrl}/api/emotions`);
        if (!response.ok) throw new Error('Failed to get emotions');
        return response.json();
    }

    /**
     * Synthesize speech
     */
    async synthesize(params) {
        const response = await fetch(`${this.baseUrl}/api/synthesize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Synthesis failed');
        }
        return response.json();
    }

    /**
     * Get synthesis progress (for polling during generation)
     */
    async getSynthesisProgress() {
        const response = await fetch(`${this.baseUrl}/api/synthesis/progress`);
        if (!response.ok) throw new Error('Failed to get progress');
        return response.json();
    }

    /**
     * Get full URL for an audio file
     */
    getAudioUrl(path) {
        if (path.startsWith('http')) {
            return path;
        }
        // Handle relative paths
        if (path.startsWith('/')) {
            return `${this.baseUrl}${path}`;
        }
        return `${this.baseUrl}/${path}`;
    }

    /**
     * Unload the TTS model to release VRAM
     */
    async unloadModel() {
        const response = await fetch(`${this.baseUrl}/api/model/unload`, {
            method: 'POST'
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to unload model');
        }
        return response.json();
    }

    /**
     * Load the TTS model
     */
    async loadModel() {
        const response = await fetch(`${this.baseUrl}/api/model/load`, {
            method: 'POST'
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to load model');
        }
        return response.json();
    }

    /**
     * Get current settings (including precision mode)
     */
    async getSettings() {
        const response = await fetch(`${this.baseUrl}/api/settings`);
        if (!response.ok) throw new Error('Failed to get settings');
        return response.json();
    }

    /**
     * Update settings (e.g., precision mode)
     * @param {Object} settings - Settings to update
     * @param {string} settings.precision_mode - 'fp16' or 'fp32'
     */
    async setSettings(settings) {
        const response = await fetch(`${this.baseUrl}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to update settings');
        }
        return response.json();
    }

    /**
     * Gracefully shutdown the server (cleans up VRAM)
     */
    async shutdownServer() {
        try {
            const response = await fetch(`${this.baseUrl}/api/shutdown`, {
                method: 'POST',
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to shutdown');
            }
            return response.json();
        } catch (error) {
            // Server might have already shutdown
            if (error.name === 'AbortError' || error.message.includes('fetch')) {
                return { success: true, message: 'Server stopped' };
            }
            throw error;
        }
    }

    /**
     * Get generation history
     */
    async getHistory() {
        const response = await fetch(`${this.baseUrl}/api/history`);
        if (!response.ok) throw new Error('Failed to get history');
        return response.json();
    }

    /**
     * Clear all history
     */
    async clearHistory() {
        const response = await fetch(`${this.baseUrl}/api/history`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to clear history');
        return response.json();
    }
}

// Export singleton instance
window.api = new VoxAIAPI();
