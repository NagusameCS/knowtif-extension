// Knowtif Browser Extension - Background Service Worker
// Handles ntfy.sh SSE connection and notifications

let eventSource = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_BASE = 1000;

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

// Save settings
async function saveSettings(settings) {
    await chrome.storage.sync.set({ settings });
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
        chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// Parse notification type from tags
function getNotificationType(tags) {
    if (!tags) return 'info';
    const tagList = tags.split(',').map(t => t.trim().toLowerCase());

    if (tagList.some(t => ['white_check_mark', 'heavy_check_mark', 'rocket', 'tada', 'star'].includes(t))) {
        return 'success';
    }
    if (tagList.some(t => ['x', 'warning', 'rotating_light', 'fire', 'skull'].includes(t))) {
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
        // Still notify popup to update history
        chrome.runtime.sendMessage({
            type: 'notification',
            data: notification
        }).catch(() => { });
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

// Connect to ntfy.sh
async function connect() {
    const settings = await getSettings();

    if (!settings.ntfyTopic) {
        console.log('Knowtif: No topic configured');
        return false;
    }

    // Disconnect existing connection
    disconnect();

    const url = `${settings.ntfyServer}/${settings.ntfyTopic}/sse`;
    console.log(`Knowtif: Connecting to ${url}`);

    try {
        eventSource = new EventSource(url);

        eventSource.onopen = () => {
            console.log('Knowtif: Connected');
            reconnectAttempts = 0;
            chrome.storage.local.set({ connected: true });
            chrome.runtime.sendMessage({ type: 'connectionChange', connected: true }).catch(() => { });
        };

        // ntfy.sh sends events with 'event: message' type, so we need addEventListener
        eventSource.addEventListener('message', (event) => {
            try {
                console.log('Knowtif: Received message', event.data);
                const data = JSON.parse(event.data);
                showNotification(data);
            } catch (e) {
                console.error('Knowtif: Error parsing message', e);
            }
        });

        eventSource.onerror = (error) => {
            console.error('Knowtif: Connection error', error);
            eventSource.close();
            eventSource = null;
            chrome.storage.local.set({ connected: false });
            chrome.runtime.sendMessage({ type: 'connectionChange', connected: false }).catch(() => { });

            // Attempt reconnect
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts - 1);
                console.log(`Knowtif: Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
                setTimeout(connect, delay);
            }
        };

        return true;
    } catch (error) {
        console.error('Knowtif: Failed to connect', error);
        return false;
    }
}

// Disconnect from ntfy.sh
function disconnect() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
        console.log('Knowtif: Disconnected');
        chrome.storage.local.set({ connected: false });
        chrome.runtime.sendMessage({ type: 'connectionChange', connected: false }).catch(() => { });
    }
}

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
            sendResponse({ connected: eventSource !== null });
            break;

        case 'testNotification':
            showNotification({
                title: 'Test Notification',
                message: 'This is a test notification from Knowtif!',
                tags: 'white_check_mark'
            });
            sendResponse(true);
            break;

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
                chrome.runtime.sendMessage({ type: 'pauseChange', paused: newPaused }).catch(() => { });
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
