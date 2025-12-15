// Knowtif Browser Extension - Background Script (Firefox)
// Uses direct SSE connection (Firefox background scripts don't terminate like Chrome MV3)

let isConnected = false;
let eventSource = null;
let reconnectTimeout = null;

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
    const result = await browser.storage.sync.get('settings');
    return { ...defaultSettings, ...result.settings };
}

// Get notification history
async function getHistory() {
    const result = await browser.storage.local.get('history');
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
    await browser.storage.local.set({ history });
    updateBadge();
}

// Update badge with unread count
async function updateBadge() {
    const history = await getHistory();
    const unreadCount = history.filter(n => !n.read).length;
    if (unreadCount > 0) {
        browser.browserAction.setBadgeText({ text: unreadCount.toString() });
        browser.browserAction.setBadgeBackgroundColor({ color: '#f85149' });
    } else {
        browser.browserAction.setBadgeText({ text: '' });
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
    const result = await browser.storage.local.get('paused');
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
        browser.runtime.sendMessage({ type: 'notification', data: notification }).catch(() => { });
        return;
    }

    // Show system notification
    if (settings.popup?.enabled) {
        const notifId = `knowtif-${Date.now()}`;
        try {
            await browser.notifications.create(notifId, {
                type: 'basic',
                iconUrl: 'icons/icon-128.png',
                title: notification.title,
                message: notification.message
            });

            if (notification.url) {
                await browser.storage.local.set({ [`notif-${notifId}`]: notification.url });
            }

            if (settings.popup.duration > 0) {
                setTimeout(() => {
                    browser.notifications.clear(notifId);
                }, settings.popup.duration);
            }
        } catch (e) {
            console.error('Knowtif: Failed to create notification', e);
        }
    }

    browser.runtime.sendMessage({ type: 'notification', data: notification }).catch(() => { });
}

// Connect to ntfy.sh via SSE
async function connect() {
    const settings = await getSettings();

    if (!settings.ntfyTopic) {
        console.log('Knowtif: No topic configured');
        return false;
    }

    // Disconnect existing connection
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    const url = `${settings.ntfyServer}/${settings.ntfyTopic}/sse`;
    console.log(`Knowtif: Connecting to ${url}`);

    try {
        eventSource = new EventSource(url);

        eventSource.onopen = () => {
            console.log('Knowtif: SSE connected');
            isConnected = true;
            browser.storage.local.set({ connected: true });
            browser.runtime.sendMessage({ type: 'connectionChange', connected: true }).catch(() => { });
        };

        eventSource.onerror = (error) => {
            console.error('Knowtif: SSE error', error);
            isConnected = false;
            browser.storage.local.set({ connected: false });
            browser.runtime.sendMessage({ type: 'connectionChange', connected: false }).catch(() => { });

            // Reconnect after delay
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            reconnectTimeout = setTimeout(() => {
                console.log('Knowtif: Attempting reconnection...');
                connect();
            }, 5000);
        };

        eventSource.addEventListener('message', (event) => {
            console.log('Knowtif: Message received', event.data);
            try {
                const data = JSON.parse(event.data);
                if (data.event === 'message') {
                    showNotification(data);
                }
            } catch (e) {
                console.error('Knowtif: Failed to parse message', e);
            }
        });

        isConnected = true;
        await browser.storage.local.set({ connected: true });
        browser.runtime.sendMessage({ type: 'connectionChange', connected: true }).catch(() => { });

        return true;
    } catch (error) {
        console.error('Knowtif: Failed to connect', error);
        return false;
    }
}

// Disconnect
async function disconnect() {
    console.log('Knowtif: Disconnecting');

    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    isConnected = false;
    await browser.storage.local.set({ connected: false });
    browser.runtime.sendMessage({ type: 'connectionChange', connected: false }).catch(() => { });
}

// Handle notification clicks
browser.notifications.onClicked.addListener(async (notificationId) => {
    const urlKey = `notif-${notificationId}`;
    const result = await browser.storage.local.get(urlKey);
    if (result[urlKey]) {
        browser.tabs.create({ url: result[urlKey] });
        await browser.storage.local.remove(urlKey);
    }
    browser.notifications.clear(notificationId);
});

// Handle messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'connect':
            connect().then(success => sendResponse(success));
            return true;

        case 'disconnect':
            disconnect().then(() => sendResponse(true));
            return true;

        case 'getStatus':
            browser.storage.local.get('connected').then(result => {
                sendResponse({ connected: result.connected || false });
            });
            return true;

        case 'clearHistory':
            browser.storage.local.set({ history: [] });
            updateBadge();
            sendResponse(true);
            break;

        case 'markAllRead':
            getHistory().then(history => {
                const updated = history.map(n => ({ ...n, read: true }));
                browser.storage.local.set({ history: updated });
                updateBadge();
                sendResponse(true);
            });
            return true;

        case 'deleteNotification':
            getHistory().then(history => {
                const updated = history.filter(n => n.id !== message.id);
                browser.storage.local.set({ history: updated });
                updateBadge();
                sendResponse(true);
            });
            return true;

        case 'togglePause':
            isPaused().then(paused => {
                const newPaused = !paused;
                browser.storage.local.set({ paused: newPaused });
                browser.runtime.sendMessage({ type: 'pauseChange', paused: newPaused }).catch(() => { });
                sendResponse(newPaused);
            });
            return true;

        case 'getPausedStatus':
            isPaused().then(paused => sendResponse(paused));
            return true;
    }
});

// Initialize
browser.runtime.onInstalled.addListener(async () => {
    console.log('Knowtif: Extension installed');
    const settings = await getSettings();
    if (settings.autoConnect && settings.ntfyTopic) {
        connect();
    }
    updateBadge();
});

browser.runtime.onStartup.addListener(async () => {
    console.log('Knowtif: Browser started');
    const settings = await getSettings();
    if (settings.autoConnect && settings.ntfyTopic) {
        connect();
    }
    updateBadge();
});
