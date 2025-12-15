// Knowtif Browser Extension - Background Service Worker
// Uses polling instead of SSE for Manifest V3 compatibility

let lastMessageTime = 0;
let pollInterval = null;
const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds

// Default settings
const defaultSettings = {
    ntfyTopic: '',
    ntfyServer: 'https://ntfy.sh',
    autoConnect: true,
    popup: {
        enabled: true,
        duration: 5000,
        sound: true
    },
    colors: {
        info: { background: '#388bfd', text: '#ffffff' },
        success: { background: '#3fb950', text: '#ffffff' },
        failure: { background: '#f85149', text: '#ffffff' }
    }
};

// Get settings from storage
async function getSettings() {
    const result = await chrome.storage.sync.get('settings');
    return { ...defaultSettings, ...result.settings };
}

// Get notification history
async function getHistory() {
    const result = await chrome.storage.local.get('history');
    return result.history || [];
}

// Add notification to history
async function addToHistory(notification) {
    const history = await getHistory();
    history.unshift({
        ...notification,
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        read: false
    });
    // Keep only last 100 notifications
    if (history.length > 100) {
        history.pop();
    }
    await chrome.storage.local.set({ history });
    updateBadge();
}

// Update badge with unread count
async function updateBadge() {
    const history = await getHistory();
    const unreadCount = history.filter(n => !n.read).length;

    if (unreadCount > 0) {
        chrome.action.setBadgeText({ text: unreadCount.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#f85149' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// Parse notification type from tags
function getNotificationType(tags) {
    if (!tags) return 'info';
    const tagList = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim().toLowerCase());

    if (tagList.some(t => ['white_check_mark', 'heavy_check_mark', 'rocket', 'tada', 'star', 'green_circle'].includes(t))) {
        return 'success';
    }
    if (tagList.some(t => ['x', 'warning', 'rotating_light', 'fire', 'skull', 'red_circle'].includes(t))) {
        return 'failure';
    }
    return 'info';
}

// Check if notifications are paused
async function isPaused() {
    const result = await chrome.storage.local.get('paused');
    return result.paused || false;
}

// Show browser notification
async function showNotification(data) {
    const settings = await getSettings();
    const paused = await isPaused();

    const type = getNotificationType(data.tags);
    const notification = {
        title: data.title || 'Knowtif',
        message: data.message || '',
        type: type,
        url: data.click || data.url || null,
        repo: data.topic || null
    };

    // Add to history (always, even when paused)
    await addToHistory(notification);

    // Skip browser notification if paused
    if (paused) {
        console.log('Knowtif: Notification paused, skipping popup');
        chrome.runtime.sendMessage({
            type: 'notification',
            data: notification
        }).catch(() => {});
        return;
    }

    // Show browser notification if enabled
    if (settings.popup.enabled) {
        const notifId = `knowtif-${Date.now()}`;

        chrome.notifications.create(notifId, {
            type: 'basic',
            iconUrl: 'icons/icon-128.png',
            title: notification.title,
            message: notification.message,
            priority: type === 'failure' ? 2 : 1
        });

        // Store URL for click handling
        if (notification.url) {
            await chrome.storage.local.set({ [`notif-${notifId}`]: notification.url });
        }

        // Auto-clear notification after duration
        if (settings.popup.duration > 0) {
            setTimeout(() => {
                chrome.notifications.clear(notifId);
            }, settings.popup.duration);
        }
    }

    // Notify popup if open
    chrome.runtime.sendMessage({
        type: 'notification',
        data: notification
    }).catch(() => {
        // Popup not open, ignore
    });
}

// Poll for new messages
async function pollMessages() {
    const settings = await getSettings();
    
    if (!settings.ntfyTopic) {
        return;
    }

    try {
        // Use since parameter to only get new messages
        const since = lastMessageTime > 0 ? `since=${lastMessageTime}` : 'poll=1';
        const url = `${settings.ntfyServer}/${settings.ntfyTopic}/json?${since}`;
        
        console.log('Knowtif: Polling', url);
        
        const response = await fetch(url);
        const text = await response.text();
        
        if (!text.trim()) {
            return;
        }

        // ntfy returns newline-delimited JSON
        const lines = text.trim().split('\n');
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
                const data = JSON.parse(line);
                console.log('Knowtif: Received', data);
                
                // Update last message time
                if (data.time && data.time > lastMessageTime) {
                    lastMessageTime = data.time;
                    await chrome.storage.local.set({ lastMessageTime });
                }
                
                // Only process actual messages
                if (data.event === 'message') {
                    await showNotification(data);
                }
            } catch (e) {
                console.error('Knowtif: Error parsing message', e, line);
            }
        }
    } catch (error) {
        console.error('Knowtif: Poll error', error);
    }
}

// Start polling
async function connect() {
    const settings = await getSettings();

    if (!settings.ntfyTopic) {
        console.log('Knowtif: No topic configured');
        return false;
    }

    // Load last message time
    const stored = await chrome.storage.local.get('lastMessageTime');
    lastMessageTime = stored.lastMessageTime || Math.floor(Date.now() / 1000);
    
    console.log(`Knowtif: Starting polling for ${settings.ntfyTopic}`);
    
    // Stop any existing polling
    disconnect();
    
    // Set up alarm for polling (works with MV3 service worker)
    chrome.alarms.create('knowtif-poll', { periodInMinutes: 0.1 }); // Every 6 seconds
    
    // Also do immediate poll
    await pollMessages();
    
    await chrome.storage.local.set({ connected: true });
    chrome.runtime.sendMessage({ type: 'connectionChange', connected: true }).catch(() => {});
    
    return true;
}

// Stop polling
function disconnect() {
    chrome.alarms.clear('knowtif-poll');
    chrome.storage.local.set({ connected: false });
    chrome.runtime.sendMessage({ type: 'connectionChange', connected: false }).catch(() => {});
    console.log('Knowtif: Disconnected');
}

// Handle alarm for polling
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'knowtif-poll') {
        const stored = await chrome.storage.local.get('connected');
        if (stored.connected) {
            await pollMessages();
        }
    }
});

// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
    const urlKey = `notif-${notificationId}`;
    const result = await chrome.storage.local.get(urlKey);

    if (result[urlKey]) {
        chrome.tabs.create({ url: result[urlKey] });
        await chrome.storage.local.remove(urlKey);
    }

    chrome.notifications.clear(notificationId);
});

// Handle messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'connect':
            connect().then(sendResponse);
            return true;

        case 'disconnect':
            disconnect();
            sendResponse(true);
            break;

        case 'getStatus':
            chrome.storage.local.get('connected').then(result => {
                sendResponse({ connected: result.connected || false });
            });
            return true;

        case 'clearHistory':
            chrome.storage.local.set({ history: [] });
            updateBadge();
            sendResponse(true);
            break;

        case 'markAllRead':
            getHistory().then(history => {
                const updated = history.map(n => ({ ...n, read: true }));
                chrome.storage.local.set({ history: updated });
                updateBadge();
                sendResponse(true);
            });
            return true;

        case 'deleteNotification':
            getHistory().then(history => {
                const updated = history.filter(n => n.id !== message.id);
                chrome.storage.local.set({ history: updated });
                updateBadge();
                sendResponse(true);
            });
            return true;

        case 'togglePause':
            isPaused().then(paused => {
                const newPaused = !paused;
                chrome.storage.local.set({ paused: newPaused });
                chrome.runtime.sendMessage({ type: 'pauseChange', paused: newPaused }).catch(() => {});
                sendResponse(newPaused);
            });
            return true;

        case 'getPausedStatus':
            isPaused().then(paused => sendResponse(paused));
            return true;
    }
});

// Initialize on install/startup
chrome.runtime.onInstalled.addListener(async () => {
    console.log('Knowtif: Extension installed');
    // Set initial lastMessageTime to now so we don't get old messages
    await chrome.storage.local.set({ lastMessageTime: Math.floor(Date.now() / 1000) });
    
    const settings = await getSettings();
    if (settings.autoConnect && settings.ntfyTopic) {
        connect();
    }
    updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Knowtif: Browser started');
    const settings = await getSettings();
    if (settings.autoConnect && settings.ntfyTopic) {
        connect();
    }
    updateBadge();
});
