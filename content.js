class D365Recorder {
    constructor() {
        this.isRecording = false;
        this.sessionId = null;
        this.stepCounter = 0;
        this.lastInteraction = null;
        this.annotationMode = false;
        this.currentHighlight = null;
        this.overlayContainer = null;
        this.noteDialog = null;
        
        this.init();
    }

    init() {
        this.createOverlayContainer();
        this.bindEvents();
        this.setupMutationObserver();
        
        // Check if we're already recording (page refresh case)
        chrome.storage.local.get(['isRecording', 'sessionId'], (result) => {
            if (result.isRecording) {
                this.startRecording(result.sessionId);
            }
        });
    }

    createOverlayContainer() {
        this.overlayContainer = document.createElement('div');
        this.overlayContainer.id = 'd365-recorder-overlay';
        this.overlayContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 999999;
        `;
        document.body.appendChild(this.overlayContainer);
    }

    bindEvents() {
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'startRecording':
                    this.startRecording(message.sessionId);
                    sendResponse({ success: true });
                    break;
                case 'stopRecording':
                    this.stopRecording();
                    sendResponse({ success: true });
                    break;
                case 'addNote':
                    this.showNoteDialog(message.element);
                    sendResponse({ success: true });
                    break;
            }
        });

        // Global click handler for recording
        document.addEventListener('click', (e) => this.handleClick(e), true);
        document.addEventListener('input', (e) => this.handleInput(e), true);
        document.addEventListener('change', (e) => this.handleChange(e), true);
        document.addEventListener('focus', (e) => this.handleFocus(e), true);
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeydown(e), true);
        
        // Mouse events for highlighting
        document.addEventListener('mouseover', (e) => this.handleMouseOver(e), true);
        document.addEventListener('mouseout', (e) => this.handleMouseOut(e), true);
    }

    setupMutationObserver() {
        // Watch for DOM changes to detect form loads, navigation, etc.
        this.observer = new MutationObserver((mutations) => {
            if (!this.isRecording) return;
            
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Check if a new form or significant content was loaded
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.checkForSignificantChange(node);
                        }
                    });
                }
            });
        });
        
        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }

    checkForSignificantChange(node) {
        // Detect D365 FO form loads, dialogs, etc.
        const significantSelectors = [
            '[data-dyn-controlname]',
            '.dyn-form',
            '.dyn-dialog',
            '[role="dialog"]',
            '.workspace-content'
        ];
        
        if (significantSelectors.some(selector => node.matches && node.matches(selector))) {
            this.recordStep({
                type: 'navigation',
                description: `Form loaded: ${this.getFormTitle(node)}`,
                element: node,
                automatic: true
            });
        }
    }

    startRecording(sessionId) {
        this.isRecording = true;
        this.sessionId = sessionId;
        this.stepCounter = 0;
        this.showRecordingIndicator();
        this.recordStep({
            type: 'session_start',
            description: 'Recording session started',
            url: window.location.href,
            pageTitle: document.title
        });
    }

    stopRecording() {
        this.isRecording = false;
        this.sessionId = null;
        this.hideRecordingIndicator();
        this.clearHighlights();
    }

    handleClick(event) {
        if (!this.isRecording) return;
        
        const element = event.target;
        const elementInfo = this.getElementInfo(element);
        
        // Skip if clicking on our own UI
        if (element.closest('#d365-recorder-overlay') || 
            element.closest('#d365-recorder-indicator') ||
            element.closest('#d365-recorder-note-dialog')) {
            return;
        }

        this.recordStep({
            type: 'click',
            description: this.generateStepDescription('click', element),
            element: element,
            elementInfo: elementInfo,
            coordinates: { x: event.clientX, y: event.clientY }
        });
    }

    handleInput(event) {
        if (!this.isRecording) return;
        
        const element = event.target;
        const elementInfo = this.getElementInfo(element);
        
        // Debounce input events
        clearTimeout(this.inputTimeout);
        this.inputTimeout = setTimeout(() => {
            this.recordStep({
                type: 'input',
                description: this.generateStepDescription('input', element),
                element: element,
                elementInfo: elementInfo,
                value: element.value
            });
        }, 1000);
    }

    handleChange(event) {
        if (!this.isRecording) return;
        
        const element = event.target;
        const elementInfo = this.getElementInfo(element);
        
        this.recordStep({
            type: 'change',
            description: this.generateStepDescription('change', element),
            element: element,
            elementInfo: elementInfo,
            value: element.type === 'checkbox' ? element.checked : element.value
        });
    }

    handleFocus(event) {
        if (!this.isRecording) return;
        
        const element = event.target;
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
            // Add visual indicator for focused field
            this.highlightElement(element, 'focus');
        }
    }

    handleKeydown(event) {
        if (!this.isRecording) return;
        
        // Ctrl+Shift+N for adding note
        if (event.ctrlKey && event.shiftKey && event.key === 'N') {
            event.preventDefault();
            this.showNoteDialog();
        }
        
        // ESC to exit annotation mode
        if (event.key === 'Escape' && this.annotationMode) {
            this.exitAnnotationMode();
        }
    }

    handleMouseOver(event) {
        if (!this.isRecording || this.annotationMode) return;
        
        const element = event.target;
        if (this.isInteractiveElement(element)) {
            this.highlightElement(element, 'hover');
        }
    }

    handleMouseOut(event) {
        if (!this.isRecording) return;
        
        this.removeHighlight('hover');
    }

    recordStep(stepData) {
        this.stepCounter++;
        
        const step = {
            id: `step_${this.stepCounter}`,
            stepNumber: this.stepCounter,
            timestamp: new Date().toISOString(),
            url: window.location.href,
            pageTitle: document.title,
            sessionId: this.sessionId,
            ...stepData
        };

        // Capture screenshot if element is provided
        if (stepData.element && !stepData.automatic) {
            this.captureElementScreenshot(stepData.element).then(screenshot => {
                step.screenshot = screenshot;
                this.saveStep(step);
            }).catch(error => {
                console.error('Screenshot capture failed:', error);
                this.saveStep(step);
            });
        } else {
            this.saveStep(step);
        }
    }

    async saveStep(step) {
        try {
            // Save to storage
            const result = await chrome.storage.local.get(['steps']);
            const steps = result.steps || [];
            steps.push(step);
            await chrome.storage.local.set({ steps });

            // Notify popup
            chrome.runtime.sendMessage({
                action: 'stepRecorded',
                step: step
            });

            console.log('Step recorded:', step);
        } catch (error) {
            console.error('Error saving step:', error);
        }
    }

    getElementInfo(element) {
        const rect = element.getBoundingClientRect();
        return {
            tagName: element.tagName,
            id: element.id,
            className: element.className,
            text: element.textContent?.trim().substring(0, 100),
            value: element.value,
            placeholder: element.placeholder,
            label: this.getElementLabel(element),
            xpath: this.getElementXPath(element),
            selector: this.getElementSelector(element),
            boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            },
            dynControlName: element.getAttribute('data-dyn-controlname'),
            dynFieldName: element.getAttribute('data-dyn-fieldname')
        };
    }

    getElementLabel(element) {
        // Try different methods to find the label
        const id = element.id;
        if (id) {
            const label = document.querySelector(`label[for="${id}"]`);
            if (label) return label.textContent.trim();
        }

        // Look for parent label
        const parentLabel = element.closest('label');
        if (parentLabel) return parentLabel.textContent.trim();

        // Look for aria-label
        if (element.getAttribute('aria-label')) {
            return element.getAttribute('aria-label');
        }

        // Look for preceding label-like element
        const prevElement = element.previousElementSibling;
        if (prevElement && (prevElement.tagName === 'LABEL' || prevElement.className.includes('label'))) {
            return prevElement.textContent.trim();
        }

        // D365 specific - look for dyn-label
        const dynLabel = element.closest('[data-dyn-controlname]')?.querySelector('.dyn-label');
        if (dynLabel) return dynLabel.textContent.trim();

        return null;
    }

    getElementXPath(element) {
        if (element.id) {
            return `//*[@id="${element.id}"]`;
        }

        const parts = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let nb = 0;
            let hasFollowingSiblings = false;
            let hasPrecedingSiblings = false;
            
            for (let sibling of element.parentNode.childNodes) {
                if (sibling.nodeType !== Node.ELEMENT_NODE) continue;
                if (sibling === element) {
                    if (nb > 0) hasPrecedingSiblings = true;
                } else if (sibling.nodeName === element.nodeName) {
                    if (nb === 0) hasFollowingSiblings = true;
                    nb++;
                }
            }
            
            const prefix = element.nodeName.toLowerCase();
            const nth = nb > 0 || hasPrecedingSiblings || hasFollowingSiblings ? `[${nb + 1}]` : '';
            parts.unshift(prefix + nth);
            element = element.parentNode;
        }
        
        return '/' + parts.join('/');
    }

    getElementSelector(element) {
        if (element.id) {
            return `#${element.id}`;
        }

        let selector = element.tagName.toLowerCase();
        if (element.className) {
            selector += '.' + element.className.split(' ').join('.');
        }

        // Make it more specific if needed
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
            let parentSelector = parent.tagName.toLowerCase();
            if (parent.id) {
                parentSelector += `#${parent.id}`;
                selector = parentSelector + ' > ' + selector;
                break;
            } else if (parent.className) {
                parentSelector += '.' + parent.className.split(' ')[0];
            }
            selector = parentSelector + ' > ' + selector;
            parent = parent.parentElement;
        }

        return selector;
    }

    generateStepDescription(action, element) {
        const label = this.getElementLabel(element);
        const dynControlName = element.getAttribute('data-dyn-controlname');
        const dynFieldName = element.getAttribute('data-dyn-fieldname');
        
        let description = '';
        
        switch (action) {
            case 'click':
                if (element.tagName === 'BUTTON') {
                    description = `Click button "${element.textContent.trim() || label || 'Unknown'}"`;
                } else if (element.tagName === 'A') {
                    description = `Click link "${element.textContent.trim() || element.href}"`;
                } else if (element.type === 'checkbox') {
                    description = `${element.checked ? 'Check' : 'Uncheck'} "${label || 'checkbox'}"`;
                } else if (element.type === 'radio') {
                    description = `Select radio button "${label || element.value}"`;
                } else {
                    description = `Click on "${label || dynControlName || element.tagName.toLowerCase()}"`;
                }
                break;
                
            case 'input':
                description = `Enter text in "${label || dynFieldName || dynControlName || 'field'}"`;
                break;
                
            case 'change':
                if (element.tagName === 'SELECT') {
                    const selectedText = element.options[element.selectedIndex]?.text || element.value;
                    description = `Select "${selectedText}" from "${label || dynFieldName || 'dropdown'}"`;
                } else {
                    description = `Change value of "${label || dynFieldName || dynControlName || 'field'}"`;
                }
                break;
                
            default:
                description = `Perform ${action} on "${label || dynControlName || element.tagName.toLowerCase()}"`;
        }
        
        return description;
    }

    getFormTitle(element) {
        // Try to find D365 FO form title
        const titleSelectors = [
            '.workspace-title',
            '.form-caption',
            '.dyn-form-caption',
            '[data-dyn-role="FormCaption"]',
            'h1', 'h2', 'h3'
        ];
        
        for (const selector of titleSelectors) {
            const titleElement = element.querySelector(selector) || document.querySelector(selector);
            if (titleElement && titleElement.textContent.trim()) {
                return titleElement.textContent.trim();
            }
        }
        
        return 'Unknown Form';
    }

    isInteractiveElement(element) {
        const interactiveTags = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
        const interactiveRoles = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'];
        
        return interactiveTags.includes(element.tagName) ||
               interactiveRoles.includes(element.getAttribute('role')) ||
               element.hasAttribute('data-dyn-controlname') ||
               element.getAttribute('tabindex') === '0' ||
               element.onclick !== null;
    }

    highlightElement(element, type = 'default') {
        this.removeHighlight(type);
        
        const rect = element.getBoundingClientRect();
        const highlight = document.createElement('div');
        highlight.className = `d365-recorder-highlight d365-recorder-highlight-${type}`;
        highlight.style.cssText = `
            position: fixed;
            left: ${rect.left}px;
            top: ${rect.top}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            border: 2px solid ${type === 'focus' ? '#0078d4' : '#28a745'};
            background: ${type === 'focus' ? 'rgba(0, 120, 212, 0.1)' : 'rgba(40, 167, 69, 0.1)'};
            pointer-events: none;
            z-index: 999998;
            border-radius: 4px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
            transition: all 0.2s ease;
        `;
        
        this.overlayContainer.appendChild(highlight);
        this.currentHighlight = highlight;
        
        // Auto-remove hover highlights
        if (type === 'hover') {
            setTimeout(() => this.removeHighlight(type), 3000);
        }
    }

    removeHighlight(type) {
        const highlights = this.overlayContainer.querySelectorAll(`.d365-recorder-highlight-${type}`);
        highlights.forEach(highlight => highlight.remove());
        
        if (type === 'hover' && this.currentHighlight?.className.includes('hover')) {
            this.currentHighlight = null;
        }
    }

    clearHighlights() {
        this.overlayContainer.innerHTML = '';
        this.currentHighlight = null;
    }

    async captureElementScreenshot(element) {
        try {
            // Ensure element is visible
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Wait a bit for scroll to complete
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Use html2canvas to capture the element
            const canvas = await html2canvas(element, {
                allowTaint: true,
                useCORS: true,
                scrollX: 0,
                scrollY: 0,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight
            });
            
            return canvas.toDataURL('image/png');
        } catch (error) {
            console.error('Error capturing screenshot:', error);
            return null;
        }
    }

    showNoteDialog(targetElement = null) {
        if (this.noteDialog) {
            this.noteDialog.remove();
        }

        const dialog = document.createElement('div');
        dialog.id = 'd365-recorder-note-dialog';
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            z-index: 1000000;
            width: 400px;
            max-width: 90vw;
            padding: 0;
            font-family: 'Segoe UI', sans-serif;
        `;

        dialog.innerHTML = `
            <div style="background: #0078d4; color: white; padding: 16px; border-radius: 8px 8px 0 0;">
                <h3 style="margin: 0; font-size: 16px;">📝 Add Note</h3>
            </div>
            <div style="padding: 20px;">
                <textarea id="noteText" placeholder="Enter your note or instruction here..." 
                    style="width: 100%; height: 100px; border: 1px solid #ddd; border-radius: 4px; padding: 10px; font-size: 14px; resize: vertical; font-family: inherit;"></textarea>
                <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="cancelNote" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Cancel</button>
                    <button id="addNote" style="background: #0078d4; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Add Note</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        this.noteDialog = dialog;

        // Focus the textarea
        const textarea = dialog.querySelector('#noteText');
        textarea.focus();

        // Bind events
        dialog.querySelector('#cancelNote').onclick = () => this.hideNoteDialog();
        dialog.querySelector('#addNote').onclick = () => {
            const noteText = textarea.value.trim();
            if (noteText) {
                this.addNoteToCurrentStep(noteText, targetElement);
            }
            this.hideNoteDialog();
        };

        // ESC to close
        dialog.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideNoteDialog();
            }
        });
    }

    hideNoteDialog() {
        if (this.noteDialog) {
            this.noteDialog.remove();
            this.noteDialog = null;
        }
    }

    addNoteToCurrentStep(noteText, targetElement) {
        this.recordStep({
            type: 'note',
            description: 'User added note',
            note: noteText,
            element: targetElement,
            manual: true
        });
    }

    showRecordingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'd365-recorder-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #dc3545;
            color: white;
            padding: 10px 15px;
            border-radius: 25px;
            font-family: 'Segoe UI', sans-serif;
            font-size: 14px;
            font-weight: 600;
            z-index: 1000000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            display: flex;
            align-items: center;
            gap: 8px;
            animation: pulse 1.5s infinite;
        `;

        indicator.innerHTML = `
            <div style="width: 8px; height: 8px; background: white; border-radius: 50%; animation: blink 1s infinite;"></div>
            REC
        `;

        // Add CSS animations
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
            }
            @keyframes blink {
                0%, 50% { opacity: 1; }
                51%, 100% { opacity: 0; }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(indicator);
    }

    hideRecordingIndicator() {
        const indicator = document.getElementById('d365-recorder-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    enterAnnotationMode() {
        this.annotationMode = true;
        document.body.style.cursor = 'crosshair';
        this.showMessage('Click on any element to add a note');
    }

    exitAnnotationMode() {
        this.annotationMode = false;
        document.body.style.cursor = '';
        this.hideMessage();
    }

    showMessage(text) {
        const message = document.createElement('div');
        message.id = 'd365-recorder-message';
        message.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            background: #0078d4;
            color: white;
            padding: 10px 15px;
            border-radius: 6px;
            font-family: 'Segoe UI', sans-serif;
            font-size: 14px;
            z-index: 1000000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;
        message.textContent = text;
        document.body.appendChild(message);

        setTimeout(() => {
            if (message.parentNode) {
                message.remove();
            }
        }, 3000);
    }

    hideMessage() {
        const message = document.getElementById('d365-recorder-message');
        if (message) {
            message.remove();
        }
    }
}

// Initialize the recorder when the page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.d365Recorder = new D365Recorder();
    });
} else {
    window.d365Recorder = new D365Recorder();
}