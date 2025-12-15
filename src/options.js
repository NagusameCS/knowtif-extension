// Options page script
const defaultSettings = {
    ntfyTopic: '',
    ntfyServer: 'https://ntfy.sh',
    autoConnect: true,
    popup: {
        enabled: true,
        duration: 5000,
        sound: false
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

document.addEventListener('DOMContentLoaded', async () => {
    // Load current settings
    const result = await chrome.storage.sync.get('settings');
    const settings = { ...defaultSettings, ...result.settings };

    // Populate fields
    document.getElementById('ntfyTopic').value = settings.ntfyTopic || '';
    document.getElementById('ntfyServer').value = settings.ntfyServer || 'https://ntfy.sh';
    document.getElementById('autoConnect').checked = settings.autoConnect;
    document.getElementById('popupEnabled').checked = settings.popup?.enabled ?? true;
    document.getElementById('popupDuration').value = settings.popup?.duration ?? 5000;
    document.getElementById('soundEnabled').checked = settings.popup?.sound ?? false;

    // Colors
    const infoColor = settings.colors?.info?.background || '#388bfd';
    const successColor = settings.colors?.success?.background || '#3fb950';
    const failureColor = settings.colors?.failure?.background || '#f85149';

    document.getElementById('colorInfoBg').value = infoColor;
    document.getElementById('colorInfoBgText').value = infoColor;
    document.getElementById('colorSuccessBg').value = successColor;
    document.getElementById('colorSuccessBgText').value = successColor;
    document.getElementById('colorFailureBg').value = failureColor;
    document.getElementById('colorFailureBgText').value = failureColor;

    // Ticker settings
    const ticker = settings.ticker || defaultSettings.ticker;
    document.getElementById('tickerEnabled').checked = ticker.enabled;
    document.getElementById('tickerPosition').value = ticker.position;
    document.getElementById('tickerHeight').value = ticker.height;
    document.getElementById('tickerFontSize').value = ticker.fontSize;
    document.getElementById('tickerSpeed').value = ticker.speed;
    document.getElementById('tickerOpacity').value = ticker.opacity;
    document.getElementById('tickerOpacityValue').textContent = `${Math.round(ticker.opacity * 100)}%`;
    document.getElementById('tickerPauseOnHover').checked = ticker.pauseOnHover;
    document.getElementById('tickerShowIcon').checked = ticker.showIcon;
    document.getElementById('tickerBgColor').value = ticker.backgroundColor;
    document.getElementById('tickerBgColorText').value = ticker.backgroundColor;
    document.getElementById('tickerTextColor').value = ticker.textColor;
    document.getElementById('tickerTextColorText').value = ticker.textColor;
    document.getElementById('tickerBorderColor').value = ticker.borderColor;
    document.getElementById('tickerBorderColorText').value = ticker.borderColor;

    // Opacity slider update
    document.getElementById('tickerOpacity').addEventListener('input', (e) => {
        document.getElementById('tickerOpacityValue').textContent = `${Math.round(e.target.value * 100)}%`;
    });

    // Sync color inputs
    function syncColorInputs(colorId, textId) {
        const colorInput = document.getElementById(colorId);
        const textInput = document.getElementById(textId);

        colorInput.addEventListener('input', () => {
            textInput.value = colorInput.value;
        });

        textInput.addEventListener('input', () => {
            if (/^#[0-9A-Fa-f]{6}$/.test(textInput.value)) {
                colorInput.value = textInput.value;
            }
        });
    }

    syncColorInputs('colorInfoBg', 'colorInfoBgText');
    syncColorInputs('colorSuccessBg', 'colorSuccessBgText');
    syncColorInputs('colorFailureBg', 'colorFailureBgText');
    syncColorInputs('tickerBgColor', 'tickerBgColorText');
    syncColorInputs('tickerTextColor', 'tickerTextColorText');
    syncColorInputs('tickerBorderColor', 'tickerBorderColorText');

    // Save button
    document.getElementById('saveBtn').addEventListener('click', async () => {
        const newSettings = {
            ntfyTopic: document.getElementById('ntfyTopic').value.trim(),
            ntfyServer: document.getElementById('ntfyServer').value.trim() || 'https://ntfy.sh',
            autoConnect: document.getElementById('autoConnect').checked,
            popup: {
                enabled: document.getElementById('popupEnabled').checked,
                duration: parseInt(document.getElementById('popupDuration').value) || 5000,
                sound: document.getElementById('soundEnabled').checked
            },
            ticker: {
                enabled: document.getElementById('tickerEnabled').checked,
                position: document.getElementById('tickerPosition').value,
                height: parseInt(document.getElementById('tickerHeight').value) || 32,
                fontSize: parseInt(document.getElementById('tickerFontSize').value) || 13,
                speed: parseInt(document.getElementById('tickerSpeed').value) || 80,
                opacity: parseFloat(document.getElementById('tickerOpacity').value) || 0.95,
                pauseOnHover: document.getElementById('tickerPauseOnHover').checked,
                showIcon: document.getElementById('tickerShowIcon').checked,
                backgroundColor: document.getElementById('tickerBgColorText').value,
                textColor: document.getElementById('tickerTextColorText').value,
                borderColor: document.getElementById('tickerBorderColorText').value,
                zIndex: 2147483647
            },
            colors: {
                info: { background: document.getElementById('colorInfoBgText').value, text: '#ffffff' },
                success: { background: document.getElementById('colorSuccessBgText').value, text: '#ffffff' },
                failure: { background: document.getElementById('colorFailureBgText').value, text: '#ffffff' }
            }
        };

        await chrome.storage.sync.set({ settings: newSettings });

        // Notify all tabs about settings update
        try {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, { type: 'settingsUpdated' }).catch(() => { });
                }
            }
        } catch (e) { }

        // Show saved message
        const savedMsg = document.getElementById('savedMessage');
        savedMsg.classList.add('show');
        setTimeout(() => savedMsg.classList.remove('show'), 2000);

        // Reconnect if topic changed
        chrome.runtime.sendMessage({ type: 'disconnect' });
        if (newSettings.ntfyTopic && newSettings.autoConnect) {
            setTimeout(() => chrome.runtime.sendMessage({ type: 'connect' }), 500);
        }
    });

    // Reset button
    document.getElementById('resetBtn').addEventListener('click', async () => {
        if (confirm('Reset all settings to defaults?')) {
            await chrome.storage.sync.set({ settings: defaultSettings });
            location.reload();
        }
    });
});
