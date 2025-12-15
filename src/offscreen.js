// Offscreen document for maintaining SSE connection
// This runs in a separate context that doesn't go dormant like the service worker

let eventSource = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_BASE = 1000;

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'startSSE':
            startSSE(message.url);
            sendResponse({ success: true });
            break;
        case 'stopSSE':
            stopSSE();
            sendResponse({ success: true });
            break;
        case 'getSSEStatus':
            sendResponse({ connected: eventSource !== null && eventSource.readyState === EventSource.OPEN });
            break;
    }
    return true;
});

function startSSE(url) {
    console.log('Offscreen: Starting SSE connection to', url);
    
    // Close existing connection
    stopSSE();
    
    try {
        eventSource = new EventSource(url);
        
        eventSource.onopen = () => {
            console.log('Offscreen: SSE Connected');
            reconnectAttempts = 0;
            // Notify background script
            chrome.runtime.sendMessage({ type: 'sseConnected' }).catch(() => {});
        };
        
        // ntfy.sh sends 'message' event type
        eventSource.addEventListener('message', (event) => {
            console.log('Offscreen: Received message', event.data);
            try {
                const data = JSON.parse(event.data);
                // Forward to background script
                chrome.runtime.sendMessage({ 
                    type: 'sseMessage', 
                    data: data 
                }).catch(() => {});
            } catch (e) {
                console.error('Offscreen: Error parsing message', e);
            }
        });
        
        eventSource.onerror = (error) => {
            console.error('Offscreen: SSE Error', error);
            
            // Notify background script
            chrome.runtime.sendMessage({ type: 'sseDisconnected' }).catch(() => {});
            
            // Close and attempt reconnect
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts - 1);
                console.log(`Offscreen: Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
                setTimeout(() => {
                    startSSE(url);
                }, delay);
            }
        };
    } catch (error) {
        console.error('Offscreen: Failed to create EventSource', error);
    }
}

function stopSSE() {
    if (eventSource) {
        console.log('Offscreen: Stopping SSE');
        eventSource.close();
        eventSource = null;
    }
    reconnectAttempts = 0;
}

console.log('Offscreen: Document loaded and ready');
