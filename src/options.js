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
            colors: {
                info: { background: document.getElementById('colorInfoBgText').value, text: '#ffffff' },
                success: { background: document.getElementById('colorSuccessBgText').value, text: '#ffffff' },
                failure: { background: document.getElementById('colorFailureBgText').value, text: '#ffffff' }
            }
        };

        await chrome.storage.sync.set({ settings: newSettings });

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
