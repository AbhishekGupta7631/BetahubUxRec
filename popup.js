class PopupController {
    constructor() {
        this.isRecording = false;
        this.steps = [];
        this.currentSession = null;
        this.init();
    }

    async init() {
        await this.loadState();
        this.bindEvents();
        this.updateUI();
    }

    async loadState() {
        try {
            const result = await chrome.storage.local.get(['isRecording', 'steps', 'currentSession']);
            this.isRecording = result.isRecording || false;
            this.steps = result.steps || [];
            this.currentSession = result.currentSession || null;
            
            if (this.currentSession) {
                document.getElementById('sessionName').value = this.currentSession.name || '';
            }
        } catch (error) {
            console.error('Error loading state:', error);
        }
    }

    async saveState() {
        try {
            await chrome.storage.local.set({
                isRecording: this.isRecording,
                steps: this.steps,
                currentSession: this.currentSession
            });
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }

    bindEvents() {
        document.getElementById('startRecording').addEventListener('click', () => this.startRecording());
        document.getElementById('stopRecording').addEventListener('click', () => this.stopRecording());
        document.getElementById('clearSteps').addEventListener('click', () => this.clearSteps());
        document.getElementById('exportJson').addEventListener('click', () => this.exportData('json'));
        document.getElementById('exportHtml').addEventListener('click', () => this.exportData('html'));
        document.getElementById('generateManual').addEventListener('click', () => this.generateManual());
        document.getElementById('sessionName').addEventListener('input', (e) => this.updateSessionName(e.target.value));
    }

    async startRecording() {
        try {
            const sessionName = document.getElementById('sessionName').value.trim();
            if (!sessionName) {
                alert('Please enter a session name before recording.');
                return;
            }

            this.currentSession = {
                id: Date.now().toString(),
                name: sessionName,
                startTime: new Date().toISOString(),
                url: await this.getCurrentTabUrl()
            };

            this.isRecording = true;
            this.steps = [];
            await this.saveState();

            // Send message to content script
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { 
                action: 'startRecording', 
                sessionId: this.currentSession.id 
            });

            this.updateUI();
            this.showNotification('Recording started! Interact with D365 FO to capture steps.');
        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Failed to start recording. Make sure you\'re on a D365 FO page.');
        }
    }

    async stopRecording() {
        try {
            this.isRecording = false;
            if (this.currentSession) {
                this.currentSession.endTime = new Date().toISOString();
            }
            await this.saveState();

            // Send message to content script
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' });

            this.updateUI();
            this.showNotification('Recording stopped! You can now export your workflow.');
        } catch (error) {
            console.error('Error stopping recording:', error);
        }
    }

    async clearSteps() {
        if (this.steps.length === 0) return;
        
        if (confirm('Are you sure you want to clear all recorded steps?')) {
            this.steps = [];
            this.currentSession = null;
            this.isRecording = false;
            await this.saveState();
            this.updateUI();
        }
    }

    updateSessionName(name) {
        if (this.currentSession) {
            this.currentSession.name = name;
            this.saveState();
        }
    }

    updateUI() {
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        const startBtn = document.getElementById('startRecording');
        const stopBtn = document.getElementById('stopRecording');
        const exportSection = document.getElementById('exportSection');

        if (this.isRecording) {
            statusDot.classList.add('recording');
            statusText.textContent = 'Recording in progress...';
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
        } else {
            statusDot.classList.remove('recording');
            statusText.textContent = this.steps.length > 0 ? `${this.steps.length} steps captured` : 'Ready to record';
            startBtn.classList.remove('hidden');
            stopBtn.classList.add('hidden');
        }

        if (this.steps.length > 0) {
            exportSection.classList.remove('hidden');
        } else {
            exportSection.classList.add('hidden');
        }

        this.renderSteps();
    }

    renderSteps() {
        const stepsList = document.getElementById('stepsList');
        const noSteps = document.getElementById('noSteps');

        if (this.steps.length === 0) {
            noSteps.classList.remove('hidden');
            return;
        }

        noSteps.classList.add('hidden');
        
        const stepsHtml = this.steps.map((step, index) => `
            <div class="step-item">
                <div class="step-number">${index + 1}</div>
                <div class="step-content">
                    <div class="step-description">${step.description || 'User interaction'}</div>
                    <div class="step-meta">
                        ${step.elementInfo ? `Element: ${step.elementInfo.tagName}` : ''}
                        ${step.timestamp ? `• ${new Date(step.timestamp).toLocaleTimeString()}` : ''}
                    </div>
                </div>
            </div>
        `).join('');

        stepsList.innerHTML = stepsHtml;
    }

    async exportData(format) {
        if (this.steps.length === 0) {
            alert('No steps to export. Record some interactions first.');
            return;
        }

        const exportData = {
            session: this.currentSession,
            steps: this.steps,
            exportedAt: new Date().toISOString(),
            totalSteps: this.steps.length
        };

        if (format === 'json') {
            this.downloadFile(
                JSON.stringify(exportData, null, 2),
                `${this.currentSession?.name || 'workflow'}_${Date.now()}.json`,
                'application/json'
            );
        } else if (format === 'html') {
            const htmlContent = this.generateHtmlReport(exportData);
            this.downloadFile(
                htmlContent,
                `${this.currentSession?.name || 'workflow'}_${Date.now()}.html`,
                'text/html'
            );
        }
    }

    generateHtmlReport(data) {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>D365 FO Training Manual - ${data.session?.name || 'Workflow'}</title>
    <style>
        body { font-family: 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: #0078d4; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .step { margin-bottom: 30px; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; }
        .step-number { background: #0078d4; color: white; border-radius: 50%; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; margin-right: 15px; }
        .screenshot { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin: 10px 0; }
        .note { background: #f8f9fa; padding: 15px; border-left: 4px solid #0078d4; margin: 10px 0; }
        .metadata { color: #6c757d; font-size: 0.9em; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📋 D365 FO Training Manual</h1>
        <h2>${data.session?.name || 'Workflow Documentation'}</h2>
        <p>Generated on: ${new Date(data.exportedAt).toLocaleString()}</p>
        <p>Total Steps: ${data.totalSteps}</p>
    </div>
    
    ${data.steps.map((step, index) => `
        <div class="step">
            <div style="display: flex; align-items: center;">
                <span class="step-number">${index + 1}</span>
                <h3>${step.description || `Step ${index + 1}`}</h3>
            </div>
            
            ${step.screenshot ? `<img src="${step.screenshot}" alt="Step ${index + 1} Screenshot" class="screenshot">` : ''}
            
            ${step.note ? `<div class="note"><strong>Note:</strong> ${step.note}</div>` : ''}
            
            <div class="metadata">
                ${step.elementInfo ? `<p><strong>Element:</strong> ${step.elementInfo.tagName} ${step.elementInfo.id ? `(ID: ${step.elementInfo.id})` : ''}</p>` : ''}
                ${step.url ? `<p><strong>URL:</strong> ${step.url}</p>` : ''}
                <p><strong>Timestamp:</strong> ${new Date(step.timestamp).toLocaleString()}</p>
            </div>
        </div>
    `).join('')}
    
    <div style="text-align: center; margin-top: 40px; color: #6c757d;">
        <p>Generated by D365 FO Training Recorder Extension</p>
    </div>
</body>
</html>`;
    }

    async generateManual() {
        if (this.steps.length === 0) {
            alert('No steps to generate manual from. Record some interactions first.');
            return;
        }

        // This would integrate with AI service to generate enhanced manual
        alert('AI-enhanced manual generation would integrate with your backend service here.');
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async getCurrentTabUrl() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab.url;
        } catch (error) {
            return null;
        }
    }

    showNotification(message) {
        // You could enhance this with a toast notification
        console.log('Notification:', message);
    }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'stepRecorded') {
        // Update steps in popup if it's open
        window.popupController?.addStep(message.step);
    }
});

// Initialize popup controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.popupController = new PopupController();
});

// Add method to popup controller to handle new steps
PopupController.prototype.addStep = async function(step) {
    this.steps.push(step);
    await this.saveState();
    this.updateUI();
};