// Popup script
document.addEventListener('DOMContentLoaded', async () => {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const connectBtn = document.getElementById('connectBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const notificationsDiv = document.getElementById('notifications');
    const clearBtn = document.getElementById('clearBtn');
    const markReadBtn = document.getElementById('markReadBtn');
    const searchInput = document.getElementById('searchInput');
    const pauseIndicator = document.getElementById('pauseIndicator');

    let currentSearchQuery = '';

    // Check if topic is configured
    const result = await chrome.storage.sync.get('settings');
    const settings = result.settings || {};

    if (!settings.ntfyTopic) {
        notificationsDiv.innerHTML = `
            <div class="setup-needed">
                <p>No topic configured. Click Settings to set up your ntfy.sh topic.</p>
                <button class="btn btn-primary" id="setupBtn">Open Settings</button>
            </div>
        `;
        document.getElementById('setupBtn').addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
    }

    // Update connection status
    async function updateStatus() {
        const response = await chrome.runtime.sendMessage({ type: 'getStatus' });
        if (response && response.connected) {
            statusDot.classList.add('connected');
            statusText.textContent = 'Connected';
            connectBtn.textContent = 'Disconnect';
            connectBtn.classList.remove('btn-primary');
            connectBtn.classList.add('btn-danger');
        } else {
            statusDot.classList.remove('connected');
            statusText.textContent = 'Disconnected';
            connectBtn.textContent = 'Connect';
            connectBtn.classList.add('btn-primary');
            connectBtn.classList.remove('btn-danger');
        }
    }

    // Update pause status UI
    async function updatePauseStatus() {
        const paused = await chrome.runtime.sendMessage({ type: 'getPausedStatus' });
        if (paused) {
            pauseBtn.textContent = 'Resume';
            pauseBtn.classList.remove('btn-secondary');
            pauseBtn.classList.add('btn-warning');
            pauseIndicator.classList.add('show');
        } else {
            pauseBtn.textContent = 'Pause';
            pauseBtn.classList.add('btn-secondary');
            pauseBtn.classList.remove('btn-warning');
            pauseIndicator.classList.remove('show');
        }
    }

    // Render notifications
    async function renderNotifications() {
        const result = await chrome.storage.local.get('history');
        let history = result.history || [];

        // Filter by search query
        if (currentSearchQuery) {
            const query = currentSearchQuery.toLowerCase();
            history = history.filter(n =>
                (n.title && n.title.toLowerCase().includes(query)) ||
                (n.message && n.message.toLowerCase().includes(query)) ||
                (n.repo && n.repo.toLowerCase().includes(query))
            );
        }

        if (history.length === 0) {
            if (currentSearchQuery) {
                notificationsDiv.innerHTML = `
                    <div class="no-results">
                        <p>No notifications matching "${escapeHtml(currentSearchQuery)}"</p>
                    </div>
                `;
            } else {
                notificationsDiv.innerHTML = `
                    <div class="empty">
                        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                        <p>No notifications yet</p>
                    </div>
                `;
            }
            return;
        }

        notificationsDiv.innerHTML = history.map(n => `
            <div class="notification ${n.read ? '' : 'unread'}" data-id="${n.id}" ${n.url ? `data-url="${n.url}"` : ''}>
                <div class="notification-icon ${n.type}">
                    ${getIcon(n.type)}
                </div>
                <div class="notification-content">
                    <div class="notification-title">${escapeHtml(n.title)}</div>
                    <div class="notification-message">${escapeHtml(n.message)}</div>
                    <div class="notification-time">${timeAgo(n.timestamp)}</div>
                </div>
                <button class="notification-delete" data-id="${n.id}" title="Delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `).join('');

        // Add click handlers
        notificationsDiv.querySelectorAll('.notification').forEach(el => {
            el.addEventListener('click', async (e) => {
                if (e.target.closest('.notification-delete')) return;

                const url = el.dataset.url;
                if (url) {
                    chrome.tabs.create({ url });
                }

                // Mark as read
                const id = el.dataset.id;
                const history = (await chrome.storage.local.get('history')).history || [];
                const updated = history.map(n => n.id === id ? { ...n, read: true } : n);
                await chrome.storage.local.set({ history: updated });
                renderNotifications();
            });
        });

        notificationsDiv.querySelectorAll('.notification-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                await chrome.runtime.sendMessage({ type: 'deleteNotification', id });
                renderNotifications();
            });
        });
    }

    function getIcon(type) {
        switch (type) {
            case 'success':
                return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
            case 'failure':
                return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
            default:
                return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[m]));
    }

    function timeAgo(timestamp) {
        const now = new Date();
        const date = new Date(timestamp);
        const diff = Math.floor((now - date) / 1000);

        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    // Event listeners
    connectBtn.addEventListener('click', async () => {
        const response = await chrome.runtime.sendMessage({ type: 'getStatus' });
        if (response && response.connected) {
            await chrome.runtime.sendMessage({ type: 'disconnect' });
        } else {
            await chrome.runtime.sendMessage({ type: 'connect' });
        }
        setTimeout(updateStatus, 500);
    });

    pauseBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'togglePause' });
        updatePauseStatus();
    });

    // Search functionality with debounce
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearchQuery = searchInput.value.trim();
            renderNotifications();
        }, 200);
    });

    settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    clearBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm('Clear all notifications?')) {
            await chrome.runtime.sendMessage({ type: 'clearHistory' });
            renderNotifications();
        }
    });

    markReadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await chrome.runtime.sendMessage({ type: 'markAllRead' });
        renderNotifications();
    });

    // Listen for new notifications
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'notification') {
            renderNotifications();
        } else if (message.type === 'connectionChange') {
            updateStatus();
        } else if (message.type === 'pauseChange') {
            updatePauseStatus();
        }
    });

    // Initial render
    updateStatus();
    updatePauseStatus();
    renderNotifications();
});
