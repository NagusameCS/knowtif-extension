// Knowtif Browser Extension - Background Service Worker
// Uses offscreen document for persistent SSE connection

let isConnected = false;

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
    ticker: {
        enabled: true,
        position: 'top',
        height: 32,
        speed: 80,
        backgroundColor: '#161b22',
        textColor: '#e6edf3',
        borderColor: '#30363d',
        showIcon: true,
        pauseOnHover: true,
        opacity: 0.95,
        fontSize: 13,
        zIndex: 2147483647
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

    await addToHistory(notification);

    if (paused) {
        console.log('Knowtif: Notification paused, skipping popup');
        chrome.runtime.sendMessage({ type: 'notification', data: notification }).catch(() => { });
        return;
    }

    // Send to all tabs for the news ticker
    if (settings.ticker?.enabled) {
        try {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'showNotification',
                        notification: notification
                    }).catch(() => { });
                }
            }
        } catch (e) {
            console.error('Knowtif: Failed to send to tabs', e);
        }
    }

    // Show system notification
    if (settings.popup?.enabled) {
        const notifId = `knowtif-${Date.now()}`;
        try {
            await chrome.notifications.create(notifId, {
                type: 'basic',
                iconUrl: 'icons/icon-128.png',
                title: notification.title,
                message: notification.message,
                priority: type === 'failure' ? 2 : 1,
                requireInteraction: false
            });

            if (notification.url) {
                await chrome.storage.local.set({ [`notif-${notifId}`]: notification.url });
            }

            if (settings.popup.duration > 0) {
                setTimeout(() => {
                    chrome.notifications.clear(notifId);
                }, settings.popup.duration);
            }
        } catch (e) {
            console.error('Knowtif: Failed to create notification', e);
        }
    }

    chrome.runtime.sendMessage({ type: 'notification', data: notification }).catch(() => { });
}

// Create offscreen document for SSE
async function createOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        console.log('Knowtif: Offscreen document already exists');
        return;
    }

    console.log('Knowtif: Creating offscreen document');
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Maintain persistent SSE connection to ntfy.sh for real-time notifications'
    });
}

// Close offscreen document
async function closeOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        await chrome.offscreen.closeDocument();
    }
}

// Connect to ntfy.sh via offscreen document
async function connect() {
    const settings = await getSettings();

    if (!settings.ntfyTopic) {
        console.log('Knowtif: No topic configured');
        return false;
    }

    const url = `${settings.ntfyServer}/${settings.ntfyTopic}/sse`;
    console.log(`Knowtif: Connecting to ${url}`);

    try {
        await createOffscreenDocument();

        // Give the document a moment to load
        await new Promise(resolve => setTimeout(resolve, 100));

        // Tell offscreen document to start SSE
        await chrome.runtime.sendMessage({ type: 'startSSE', url: url });

        isConnected = true;
        await chrome.storage.local.set({ connected: true });
        chrome.runtime.sendMessage({ type: 'connectionChange', connected: true }).catch(() => { });

        return true;
    } catch (error) {
        console.error('Knowtif: Failed to connect', error);
        return false;
    }
}

// Disconnect
async function disconnect() {
    console.log('Knowtif: Disconnecting');

    try {
        await chrome.runtime.sendMessage({ type: 'stopSSE' });
    } catch (e) {
        // Offscreen document might not exist
    }

    await closeOffscreenDocument();

    isConnected = false;
    await chrome.storage.local.set({ connected: false });
    chrome.runtime.sendMessage({ type: 'connectionChange', connected: false }).catch(() => { });
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

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        // Messages from popup/options
        case 'connect':
            connect().then(success => sendResponse(success));
            return true;

        case 'disconnect':
            disconnect().then(() => sendResponse(true));
            return true;

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
                chrome.runtime.sendMessage({ type: 'pauseChange', paused: newPaused }).catch(() => { });
                sendResponse(newPaused);
            });
            return true;

        case 'getPausedStatus':
            isPaused().then(paused => sendResponse(paused));
            return true;

        // Messages from offscreen document
        case 'sseConnected':
            console.log('Knowtif: SSE connected (from offscreen)');
            isConnected = true;
            chrome.storage.local.set({ connected: true });
            chrome.runtime.sendMessage({ type: 'connectionChange', connected: true }).catch(() => { });
            break;

        case 'sseDisconnected':
            console.log('Knowtif: SSE disconnected (from offscreen)');
            isConnected = false;
            chrome.storage.local.set({ connected: false });
            chrome.runtime.sendMessage({ type: 'connectionChange', connected: false }).catch(() => { });
            break;

        case 'sseMessage':
            console.log('Knowtif: Message received', message.data);
            if (message.data && message.data.event === 'message') {
                showNotification(message.data);
            }
            break;
    }
});

// Initialize
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
