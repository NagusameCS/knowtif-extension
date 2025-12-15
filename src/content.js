// Knowtif Content Script - News Ticker Banner
(function () {
    'use strict';

    let tickerContainer = null;
    let tickerContent = null;
    let notificationQueue = [];
    let isAnimating = false;
    let settings = null;

    // Default ticker settings
    const defaultTickerSettings = {
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
    };

    // Load settings from storage
    async function loadSettings() {
        try {
            const result = await chrome.storage.sync.get('settings');
            const userSettings = result.settings || {};
            settings = {
                ...userSettings,
                ticker: { ...defaultTickerSettings, ...(userSettings.ticker || {}) }
            };
            return settings;
        } catch (e) {
            console.error('Knowtif: Failed to load settings', e);
            settings = { ticker: defaultTickerSettings };
            return settings;
        }
    }

    // Create the ticker banner
    function createTicker() {
        if (tickerContainer) return;

        const ticker = settings?.ticker || defaultTickerSettings;

        // Container
        tickerContainer = document.createElement('div');
        tickerContainer.id = 'knowtif-ticker-container';
        tickerContainer.style.cssText = `
            position: fixed;
            ${ticker.position === 'top' ? 'top: 0;' : 'bottom: 0;'}
            left: 0;
            right: 0;
            height: ${ticker.height}px;
            background: ${ticker.backgroundColor};
            border-${ticker.position === 'top' ? 'bottom' : 'top'}: 1px solid ${ticker.borderColor};
            z-index: ${ticker.zIndex};
            opacity: ${ticker.opacity};
            display: none;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: ${ticker.fontSize}px;
            color: ${ticker.textColor};
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
            transition: transform 0.3s ease, opacity 0.3s ease;
        `;

        // Inner wrapper for animation
        const tickerWrapper = document.createElement('div');
        tickerWrapper.id = 'knowtif-ticker-wrapper';
        tickerWrapper.style.cssText = `
            display: flex;
            align-items: center;
            height: 100%;
            white-space: nowrap;
            position: relative;
        `;

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.id = 'knowtif-ticker-close';
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            width: 20px;
            height: 20px;
            border: none;
            background: rgba(255, 255, 255, 0.1);
            color: ${ticker.textColor};
            font-size: 16px;
            line-height: 1;
            cursor: pointer;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
            transition: background 0.2s;
        `;
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        closeBtn.addEventListener('click', () => {
            hideTicker();
        });

        // Content area for scrolling text
        tickerContent = document.createElement('div');
        tickerContent.id = 'knowtif-ticker-content';
        tickerContent.style.cssText = `
            display: inline-block;
            padding-left: 100%;
            animation: none;
        `;

        tickerWrapper.appendChild(tickerContent);
        tickerWrapper.appendChild(closeBtn);
        tickerContainer.appendChild(tickerWrapper);

        // Pause on hover
        if (ticker.pauseOnHover) {
            tickerContainer.addEventListener('mouseenter', () => {
                if (tickerContent) {
                    tickerContent.style.animationPlayState = 'paused';
                }
            });
            tickerContainer.addEventListener('mouseleave', () => {
                if (tickerContent) {
                    tickerContent.style.animationPlayState = 'running';
                }
            });
        }

        // Inject styles for animation
        const style = document.createElement('style');
        style.id = 'knowtif-ticker-styles';
        style.textContent = `
            @keyframes knowtif-scroll {
                0% { transform: translateX(0); }
                100% { transform: translateX(-100%); }
            }
            #knowtif-ticker-container.knowtif-visible {
                display: block !important;
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(tickerContainer);

        // Add body padding to prevent content overlap
        updateBodyPadding();
    }

    // Update body padding when ticker is visible
    function updateBodyPadding() {
        const ticker = settings?.ticker || defaultTickerSettings;
        if (tickerContainer && tickerContainer.classList.contains('knowtif-visible')) {
            if (ticker.position === 'top') {
                document.body.style.marginTop = `${ticker.height}px`;
            } else {
                document.body.style.marginBottom = `${ticker.height}px`;
            }
        } else {
            document.body.style.marginTop = '';
            document.body.style.marginBottom = '';
        }
    }

    // Show notification in ticker
    function showInTicker(notification) {
        const ticker = settings?.ticker || defaultTickerSettings;
        if (!ticker.enabled) return;

        createTicker();

        // Get color based on type
        const colors = settings?.colors || {
            info: { background: '#388bfd' },
            success: { background: '#3fb950' },
            failure: { background: '#f85149' }
        };
        const typeColor = colors[notification.type]?.background || '#388bfd';

        // Create notification element
        const notifEl = document.createElement('span');
        notifEl.className = 'knowtif-ticker-item';
        notifEl.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 0 40px;
        `;

        // Icon/indicator
        if (ticker.showIcon) {
            const icon = document.createElement('span');
            icon.style.cssText = `
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: ${typeColor};
                flex-shrink: 0;
            `;
            notifEl.appendChild(icon);
        }

        // Title
        if (notification.title) {
            const title = document.createElement('strong');
            title.textContent = notification.title;
            title.style.cssText = `
                color: ${typeColor};
                margin-right: 6px;
            `;
            notifEl.appendChild(title);
        }

        // Message
        const message = document.createElement('span');
        message.textContent = notification.message || '';
        notifEl.appendChild(message);

        // Separator
        const separator = document.createElement('span');
        separator.textContent = '•';
        separator.style.cssText = `
            opacity: 0.4;
            margin: 0 20px;
        `;
        notifEl.appendChild(separator);

        // Add to queue
        notificationQueue.push(notifEl);

        // If not currently animating, start animation
        if (!isAnimating) {
            animateNextNotification();
        }
    }

    // Animate the next notification in queue
    function animateNextNotification() {
        if (notificationQueue.length === 0) {
            isAnimating = false;
            // Hide ticker after a delay if no more notifications
            setTimeout(() => {
                if (notificationQueue.length === 0) {
                    hideTicker();
                }
            }, 1000);
            return;
        }

        isAnimating = true;
        const ticker = settings?.ticker || defaultTickerSettings;

        // Show container
        tickerContainer.classList.add('knowtif-visible');
        updateBodyPadding();

        // Clear and add current notification
        tickerContent.innerHTML = '';
        const currentNotif = notificationQueue.shift();
        tickerContent.appendChild(currentNotif);

        // Calculate animation duration based on content width and speed
        const contentWidth = tickerContent.scrollWidth;
        const screenWidth = window.innerWidth;
        const totalDistance = contentWidth + screenWidth;
        const duration = totalDistance / ticker.speed;

        // Apply animation
        tickerContent.style.animation = `knowtif-scroll ${duration}s linear`;

        // When animation ends, show next notification
        tickerContent.addEventListener('animationend', function handler() {
            tickerContent.removeEventListener('animationend', handler);
            tickerContent.style.animation = 'none';
            animateNextNotification();
        }, { once: true });
    }

    // Hide ticker
    function hideTicker() {
        if (tickerContainer) {
            tickerContainer.classList.remove('knowtif-visible');
            updateBodyPadding();
        }
        notificationQueue = [];
        isAnimating = false;
    }

    // Update ticker appearance
    function updateTickerAppearance() {
        if (!tickerContainer) return;

        const ticker = settings?.ticker || defaultTickerSettings;

        tickerContainer.style.top = ticker.position === 'top' ? '0' : 'auto';
        tickerContainer.style.bottom = ticker.position === 'bottom' ? '0' : 'auto';
        tickerContainer.style.height = `${ticker.height}px`;
        tickerContainer.style.background = ticker.backgroundColor;
        tickerContainer.style.color = ticker.textColor;
        tickerContainer.style.borderTop = ticker.position === 'bottom' ? `1px solid ${ticker.borderColor}` : 'none';
        tickerContainer.style.borderBottom = ticker.position === 'top' ? `1px solid ${ticker.borderColor}` : 'none';
        tickerContainer.style.opacity = ticker.opacity;
        tickerContainer.style.fontSize = `${ticker.fontSize}px`;
        tickerContainer.style.zIndex = ticker.zIndex;

        updateBodyPadding();
    }

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('Knowtif Content: Received message', message.type);
        if (message.type === 'showNotification') {
            console.log('Knowtif Content: Showing notification in ticker', message.notification);
            loadSettings().then(() => {
                showInTicker(message.notification);
            });
            sendResponse({ received: true });
        } else if (message.type === 'settingsUpdated') {
            loadSettings().then(() => {
                updateTickerAppearance();
            });
            sendResponse({ received: true });
        } else if (message.type === 'hideTicker') {
            hideTicker();
            sendResponse({ received: true });
        }
        return true;
    });

    // Initialize
    loadSettings().then(() => {
        console.log('Knowtif: Content script loaded and ready');
    });
})();
