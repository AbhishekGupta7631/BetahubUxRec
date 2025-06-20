document.addEventListener('DOMContentLoaded', () => {
    const stepsOutput = document.getElementById('steps-output');
    if (!stepsOutput) {
        console.error('Error: Could not find steps-output element.');
        return;
    }

    chrome.storage.local.get('exportDataForViewer', (result) => {
        if (chrome.runtime.lastError) {
            stepsOutput.innerHTML = '<p style="color: red;">Error loading data from storage: ' + chrome.runtime.lastError.message + '</p>';
            console.error('Error loading data:', chrome.runtime.lastError);
            return;
        }

        const data = result.exportDataForViewer;

        if (!data || !data.steps || data.steps.length === 0) {
            stepsOutput.innerHTML = '<p>No steps data found or steps array is empty.</p>';
            if (data) { // Data object exists but steps might be empty or missing
                chrome.storage.local.remove('exportDataForViewer', () => {
                    if (chrome.runtime.lastError) {
                        console.error('Error removing data after empty check:', chrome.runtime.lastError.message);
                    } else {
                        console.log('Cleaned up exportDataForViewer for empty/missing steps.');
                    }
                });
            }
            return;
        }

        let htmlContent = '';

        // Display session information if available
        if (data.session) {
            htmlContent += '<h2>Session Information</h2>';
            htmlContent += `<p><strong>Name:</strong> ${data.session.name || 'N/A'}</p>`;
            if (data.session.startTime) {
                 htmlContent += `<p><strong>Started:</strong> ${new Date(data.session.startTime).toLocaleString()}</p>`;
            }
            if (data.session.url) {
                htmlContent += `<p><strong>Initial URL:</strong> <a href="${data.session.url}" target="_blank">${data.session.url}</a></p>`;
            }
            htmlContent += `<p><strong>Exported At:</strong> ${new Date(data.exportedAt).toLocaleString()}</p>`;
            htmlContent += `<p><strong>Total Steps:</strong> ${data.totalSteps}</p>`;
            htmlContent += '<hr>';
        }


        data.steps.forEach(step => {
            htmlContent += '<div class="step-item">';
            htmlContent += `<h3>Step ${step.stepNumber}: ${step.description || 'No description'}</h3>`;
            htmlContent += `<p><strong>Timestamp:</strong> ${new Date(step.timestamp).toLocaleString()}</p>`;
            if (step.url) {
                htmlContent += `<p><strong>URL:</strong> <a href="${step.url}" target="_blank">${step.url}</a></p>`;
            }
            if (step.note) {
                htmlContent += `<p><strong>Note:</strong> ${step.note.replace(/\n/g, '<br>')}</p>`;
            }

            if (step.elementInfo) {
                htmlContent += '<h4>Element Information:</h4>';
                htmlContent += `<p><strong>Tag:</strong> ${step.elementInfo.tagName || 'N/A'}</p>`;
                if (step.elementInfo.selector) {
                     htmlContent += `<p><strong>Selector:</strong> ${step.elementInfo.selector}</p>`;
                }
                if (step.elementInfo.text && step.elementInfo.text.length < 100) { // Avoid very long text prints
                    htmlContent += `<p><strong>Text Content:</strong> ${step.elementInfo.text}</p>`;
                }
                 if (step.elementInfo.label) {
                    htmlContent += `<p><strong>Label:</strong> ${step.elementInfo.label}</p>`;
                }
                if (step.elementInfo.dynControlName) {
                    htmlContent += `<p><strong>DYN Control Name:</strong> ${step.elementInfo.dynControlName}</p>`;
                }

            }

            if (step.screenshot) {
                htmlContent += '<h4>Screenshot:</h4>';
                htmlContent += `<img src="${step.screenshot}" alt="Screenshot for step ${step.stepNumber}">`;
            }
            htmlContent += '</div>';
        });

        stepsOutput.innerHTML = htmlContent;

        // Clean up the data from storage after rendering
        chrome.storage.local.remove('exportDataForViewer', () => {
            if (chrome.runtime.lastError) {
                console.error('Error removing exportDataForViewer from storage:', chrome.runtime.lastError.message);
            } else {
                console.log('Successfully loaded and removed exportDataForViewer from storage.');
            }
        });
    });
});
