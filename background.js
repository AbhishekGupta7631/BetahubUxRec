// background.js - Service Worker for D365 FO Training Recorder
class RecordingManager {
    constructor() {
        this.sessions = new Map();
        this.activeRecordings = new Set();
        this.init();
    }

    init() {
        // Set up message listener
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Will respond asynchronously
        });

        // Set up tab listeners
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdate(tabId, changeInfo, tab);
        });

        chrome.tabs.onRemoved.addListener((tabId) => {
            this.handleTabRemoved(tabId);
        });

        // Clean up old data periodically (every hour)
        setInterval(() => this.cleanupOldData(), 60 * 60 * 1000);

        console.log('D365 FO Training Recorder background service initialized');
    }

    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.action) {
                case 'startRecording':
                    await this.startRecording(message, sender.tab?.id);
                    sendResponse({ success: true });
                    break;

                case 'stopRecording':
                    await this.stopRecording(message, sender.tab?.id);
                    sendResponse({ success: true });
                    break;

                case 'saveStep':
                    await this.saveStep(message.step, sender.tab?.id);
                    sendResponse({ success: true });
                    break;

                case 'getRecording':
                    const session = this.sessions.get(sender.tab?.id);
                    if (session) {
                        sendResponse({ success: true, session });
                    } else {
                        sendResponse({ success: false, message: 'No active session' });
                    }
                    break;

                case 'clearRecording':
                    this.sessions.delete(sender.tab?.id);
                    this.activeRecordings.delete(sender.tab?.id);
                    await this.clearStoredSession(sender.tab?.id);
                    sendResponse({ success: true });
                    break;

                case 'getSessionData':
                    const sessionData = await this.getSessionData(sender.tab?.id);
                    sendResponse({ success: true, data: sessionData });
                    break;

                case 'updateSessionSettings':
                    await this.updateSessionSettings(message.settings, sender.tab?.id);
                    sendResponse({ success: true });
                    break;

                case 'openTabForExportViewer': // New case
                    const viewerUrl = chrome.runtime.getURL('export_viewer.html');
                    chrome.tabs.create({ url: viewerUrl }, (tab) => {
                        if (chrome.runtime.lastError) {
                            console.error("Error opening export viewer tab:", chrome.runtime.lastError.message);
                            sendResponse({ success: false, message: 'Failed to open export viewer tab: ' + chrome.runtime.lastError.message });
                        } else {
                            sendResponse({ success: true, message: 'Export viewer tab opened.', tabId: tab.id });
                        }
                    });
                    return true; // Indicate we will send a response asynchronously

                default:
                    sendResponse({ success: false, message: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', message, error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async startRecording(message, tabId) {
        if (!tabId) return;

        // Get current tab info
        const tab = await this.getTabInfo(tabId);

        const session = {
            id: message.sessionId || Date.now().toString(),
            startTime: new Date().toISOString(),
            steps: [],
            metadata: {
                url: message.url || tab?.url || '',
                title: message.title || tab?.title || '',
                userAgent: message.userAgent || navigator.userAgent,
                sessionName: message.sessionName || 'Untitled Workflow'
            },
            settings: {
                captureScreenshots: true,
                captureClicks: true,
                captureKeystrokes: true,
                captureNavigation: true,
                autoAnnotate: false
            }
        };

        this.sessions.set(tabId, session);
        this.activeRecordings.add(tabId);
        
        // Store session in chrome storage for persistence
        await this.storeSession(tabId, session);
        
        console.log(`Started recording session ${session.id} on tab ${tabId}`);
        
        // Notify content script that recording has started
        try {
            await chrome.tabs.sendMessage(tabId, {
                action: 'recordingStarted',
                sessionId: session.id
            });
        } catch (error) {
            console.warn('Failed to notify content script:', error);
        }
    }

    async stopRecording(message, tabId) {
        if (!tabId) return;

        const session = this.sessions.get(tabId);
        if (session) {
            session.endTime = new Date().toISOString();
            session.duration = new Date(session.endTime) - new Date(session.startTime);
            this.activeRecordings.delete(tabId);
            
            // Update stored session
            await this.storeSession(tabId, session);
            
            console.log(`Stopped recording session ${session.id} on tab ${tabId}. Captured ${session.steps.length} steps.`);
            
            // Notify content script that recording has stopped
            try {
                await chrome.tabs.sendMessage(tabId, {
                    action: 'recordingStopped',
                    sessionId: session.id
                });
            } catch (error) {
                console.warn('Failed to notify content script:', error);
            }
        }
    }

    async saveStep(step, tabId) {
        if (!tabId || !step) return;

        const session = this.sessions.get(tabId);
        if (session && this.activeRecordings.has(tabId)) {
            const enhancedStep = {
                ...step,
                id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                timestamp: new Date().toISOString(),
                sessionId: session.id,
                stepNumber: session.steps.length + 1
            };

            session.steps.push(enhancedStep);
            
            // Update stored session
            await this.storeSession(tabId, session);

            console.log(`Saved step ${enhancedStep.stepNumber} for session ${session.id}`);

            // Broadcast step to popup if open
            try {
                chrome.runtime.sendMessage({
                    action: 'stepRecorded',
                    step: enhancedStep,
                    sessionId: session.id,
                    tabId: tabId
                });
            } catch (error) {
                // Popup might not be open, that's okay
            }

            // Check if we've reached max steps limit
            if (session.steps.length >= 100) {
                console.warn(`Session ${session.id} reached maximum steps (100). Auto-stopping recording.`);
                await this.stopRecording({}, tabId);
                
                // Notify user via notification
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon48.png',
                    title: 'D365 FO Recorder',
                    message: 'Recording stopped: Maximum steps (100) reached.'
                });
            }
        }
    }

    async updateSessionSettings(settings, tabId) {
        const session = this.sessions.get(tabId);
        if (session) {
            session.settings = { ...session.settings, ...settings };
            await this.storeSession(tabId, session);
        }
    }

    async getSessionData(tabId) {
        const session = this.sessions.get(tabId);
        if (session) {
            return {
                session,
                isRecording: this.activeRecordings.has(tabId),
                stepCount: session.steps.length
            };
        }
        
        // Try to load from storage if not in memory
        const storedSession = await this.loadStoredSession(tabId);
        if (storedSession) {
            this.sessions.set(tabId, storedSession);
            return {
                session: storedSession,
                isRecording: false,
                stepCount: storedSession.steps.length
            };
        }
        
        return null;
    }

    handleTabUpdate(tabId, changeInfo, tab) {
        if (changeInfo.status === 'complete' && this.activeRecordings.has(tabId)) {
            const session = this.sessions.get(tabId);
            if (session && session.settings.captureNavigation) {
                // Create a navigation step
                const navigationStep = {
                    type: 'navigation',
                    description: `Navigated to ${tab.title}`,
                    url: tab.url,
                    elementInfo: {
                        tagName: 'NAVIGATION',
                        action: 'page_load'
                    }
                };
                
                this.saveStep(navigationStep, tabId);
            }
            
            console.log(`Tab ${tabId} navigated to ${tab.url}`);
        }
    }

    handleTabRemoved(tabId) {
        const session = this.sessions.get(tabId);
        if (session) {
            console.log(`Tab ${tabId} closed. Session ${session.id} had ${session.steps.length} steps.`);
        }
        
        this.sessions.delete(tabId);
        this.activeRecordings.delete(tabId);
        this.clearStoredSession(tabId);
    }

    async cleanupOldData() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        for (const [tabId, session] of this.sessions.entries()) {
            const sessionTime = new Date(session.startTime).getTime();
            if (now - sessionTime > maxAge) {
                this.sessions.delete(tabId);
                this.activeRecordings.delete(tabId);
                await this.clearStoredSession(tabId);
                console.log(`Cleaned up old session ${session.id} from tab ${tabId}`);
            }
        }
        
        // Also cleanup orphaned storage entries
        const storage = await chrome.storage.local.get();
        const keysToRemove = [];
        
        for (const key in storage) {
            if (key.startsWith('session_')) {
                const sessionData = storage[key];
                if (sessionData && sessionData.startTime) {
                    const sessionTime = new Date(sessionData.startTime).getTime();
                    if (now - sessionTime > maxAge) {
                        keysToRemove.push(key);
                    }
                }
            }
        }
        
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log(`Cleaned up ${keysToRemove.length} orphaned storage entries`);
        }
    }

    async getTabInfo(tabId) {
        try {
            return await chrome.tabs.get(tabId);
        } catch (error) {
            console.warn(`Failed to get tab info for ${tabId}:`, error);
            return null;
        }
    }

    async storeSession(tabId, session) {
        try {
            await chrome.storage.local.set({
                [`session_${tabId}`]: session,
                [`recording_${tabId}`]: this.activeRecordings.has(tabId)
            });
        } catch (error) {
            console.error('Failed to store session:', error);
        }
    }

    async loadStoredSession(tabId) {
        try {
            const result = await chrome.storage.local.get([`session_${tabId}`]);
            return result[`session_${tabId}`] || null;
        } catch (error) {
            console.error('Failed to load stored session:', error);
            return null;
        }
    }

    async clearStoredSession(tabId) {
        try {
            await chrome.storage.local.remove([`session_${tabId}`, `recording_${tabId}`]);
        } catch (error) {
            console.error('Failed to clear stored session:', error);
        }
    }

    // Public method to get all active recordings (for debugging)
    getActiveRecordings() {
        return Array.from(this.activeRecordings);
    }

    // Public method to get session count (for debugging)
    getSessionCount() {
        return this.sessions.size;
    }
}

// Initialize the recording manager
const recordingManager = new RecordingManager();

// Handle extension installation/updates
chrome.runtime.onInstalled.addListener((details) => {
    console.log('D365 FO Training Recorder installed/updated:', details);
    
    if (details.reason === 'install') {
        // Set default settings on first install
        chrome.storage.local.set({
            version: chrome.runtime.getManifest().version,
            installDate: new Date().toISOString(),
            defaultSettings: {
                captureScreenshots: true,
                captureClicks: true,
                captureKeystrokes: true,
                captureNavigation: true,
                autoAnnotate: false,
                maxSteps: 100
            }
        });
    }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
    console.log('D365 FO Training Recorder service worker started');
});

// Export for testing purposes (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RecordingManager };
}