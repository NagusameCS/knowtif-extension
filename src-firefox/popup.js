// Popup script (Firefox)
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
    const result = await browser.storage.sync.get('settings');
    const settings = result.settings || {};

    if (!settings.ntfyTopic) {
        const setupDiv = document.createElement('div');
        setupDiv.className = 'setup-needed';

        const p = document.createElement('p');
        p.textContent = 'No topic configured. Click Settings to set up your ntfy.sh topic.';
        setupDiv.appendChild(p);

        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.textContent = 'Open Settings';
        btn.addEventListener('click', () => {
            browser.runtime.openOptionsPage();
        });
        setupDiv.appendChild(btn);

        notificationsDiv.textContent = '';
        notificationsDiv.appendChild(setupDiv);
    }

    // Update connection status
    async function updateStatus() {
        const response = await browser.runtime.sendMessage({ type: 'getStatus' });
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
        const paused = await browser.runtime.sendMessage({ type: 'getPausedStatus' });
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

    // Create notification element safely
    function createNotificationElement(n) {
        const div = document.createElement('div');
        div.className = `notification ${n.read ? '' : 'unread'}`;
        div.dataset.id = n.id;
        if (n.url) div.dataset.url = n.url;

        // Icon
        const iconDiv = document.createElement('div');
        iconDiv.className = `notification-icon ${n.type}`;
        const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.setAttribute('fill', 'currentColor');
        const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        switch (n.type) {
            case 'success':
                iconPath.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
                break;
            case 'failure':
                iconPath.setAttribute('d', 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
                break;
            default:
                iconPath.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z');
        }
        iconSvg.appendChild(iconPath);
        iconDiv.appendChild(iconSvg);
        div.appendChild(iconDiv);

        // Content
        const contentDiv = document.createElement('div');
        contentDiv.className = 'notification-content';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'notification-title';
        titleDiv.textContent = n.title || '';
        contentDiv.appendChild(titleDiv);

        const messageDiv = document.createElement('div');
        messageDiv.className = 'notification-message';
        messageDiv.textContent = n.message || '';
        contentDiv.appendChild(messageDiv);

        const timeDiv = document.createElement('div');
        timeDiv.className = 'notification-time';
        timeDiv.textContent = timeAgo(n.timestamp);
        contentDiv.appendChild(timeDiv);

        div.appendChild(contentDiv);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'notification-delete';
        deleteBtn.dataset.id = n.id;
        deleteBtn.title = 'Delete';
        const deleteSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        deleteSvg.setAttribute('width', '14');
        deleteSvg.setAttribute('height', '14');
        deleteSvg.setAttribute('viewBox', '0 0 24 24');
        deleteSvg.setAttribute('fill', 'none');
        deleteSvg.setAttribute('stroke', 'currentColor');
        deleteSvg.setAttribute('stroke-width', '2');
        const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line1.setAttribute('x1', '18');
        line1.setAttribute('y1', '6');
        line1.setAttribute('x2', '6');
        line1.setAttribute('y2', '18');
        const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line2.setAttribute('x1', '6');
        line2.setAttribute('y1', '6');
        line2.setAttribute('x2', '18');
        line2.setAttribute('y2', '18');
        deleteSvg.appendChild(line1);
        deleteSvg.appendChild(line2);
        deleteBtn.appendChild(deleteSvg);
        div.appendChild(deleteBtn);

        return div;
    }

    // Render notifications
    async function renderNotifications() {
        const result = await browser.storage.local.get('history');
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

        // Clear existing content
        notificationsDiv.textContent = '';

        if (history.length === 0) {
            const emptyDiv = document.createElement('div');

            if (currentSearchQuery) {
                emptyDiv.className = 'no-results';
                const p = document.createElement('p');
                p.textContent = `No notifications matching "${currentSearchQuery}"`;
                emptyDiv.appendChild(p);
            } else {
                emptyDiv.className = 'empty';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'empty-icon');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '1.5');
                const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path1.setAttribute('d', 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9');
                const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path2.setAttribute('d', 'M13.73 21a2 2 0 0 1-3.46 0');
                svg.appendChild(path1);
                svg.appendChild(path2);
                emptyDiv.appendChild(svg);
                const p = document.createElement('p');
                p.textContent = 'No notifications yet';
                emptyDiv.appendChild(p);
            }

            notificationsDiv.appendChild(emptyDiv);
            return;
        }

        // Create notification elements
        history.forEach(n => {
            const el = createNotificationElement(n);

            // Click handler for notification
            el.addEventListener('click', async (e) => {
                if (e.target.closest('.notification-delete')) return;

                const url = el.dataset.url;
                if (url) {
                    browser.tabs.create({ url });
                }

                // Mark as read
                const id = el.dataset.id;
                const historyResult = await browser.storage.local.get('history');
                const currentHistory = historyResult.history || [];
                const updated = currentHistory.map(item => item.id === id ? { ...item, read: true } : item);
                await browser.storage.local.set({ history: updated });
                renderNotifications();
            });

            // Delete button handler
            const deleteBtn = el.querySelector('.notification-delete');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = deleteBtn.dataset.id;
                await browser.runtime.sendMessage({ type: 'deleteNotification', id });
                renderNotifications();
            });

            notificationsDiv.appendChild(el);
        });
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
        const response = await browser.runtime.sendMessage({ type: 'getStatus' });
        if (response && response.connected) {
            await browser.runtime.sendMessage({ type: 'disconnect' });
        } else {
            await browser.runtime.sendMessage({ type: 'connect' });
        }
        setTimeout(updateStatus, 500);
    });

    pauseBtn.addEventListener('click', async () => {
        await browser.runtime.sendMessage({ type: 'togglePause' });
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
        browser.runtime.openOptionsPage();
    });

    clearBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm('Clear all notifications?')) {
            await browser.runtime.sendMessage({ type: 'clearHistory' });
            renderNotifications();
        }
    });

    markReadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await browser.runtime.sendMessage({ type: 'markAllRead' });
        renderNotifications();
    });

    // Listen for new notifications
    browser.runtime.onMessage.addListener((message) => {
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
