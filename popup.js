// popup.js
// Handles reading and saving GemiBoost export preferences

const DEFAULT_SETTINGS = {
  includeThought: true,
  includeLink: true,
  includeAccount: false
};

document.addEventListener('DOMContentLoaded', () => {
  const thoughtToggle = document.getElementById('includeThought');
  const linkToggle = document.getElementById('includeLink');
  const accountToggle = document.getElementById('includeAccount');

  // Load preferences from chrome.storage
  const storage =
    typeof chrome !== 'undefined' && chrome.storage
      ? chrome.storage.sync || chrome.storage.local
      : null;

  if (storage) {
    storage.get(DEFAULT_SETTINGS, (items) => {
      thoughtToggle.checked = items.includeThought !== false;
      linkToggle.checked = items.includeLink !== false;
      accountToggle.checked = !!items.includeAccount;
    });
  } else {
    try {
      const raw = localStorage.getItem('gemiboost_export_settings');
      const items = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
      thoughtToggle.checked = items.includeThought !== false;
      linkToggle.checked = items.includeLink !== false;
      accountToggle.checked = !!items.includeAccount;
    } catch (e) {
      thoughtToggle.checked = DEFAULT_SETTINGS.includeThought;
      linkToggle.checked = DEFAULT_SETTINGS.includeLink;
      accountToggle.checked = DEFAULT_SETTINGS.includeAccount;
    }
  }

  // Save preferences on change
  const saveSettings = () => {
    const newSettings = {
      includeThought: thoughtToggle.checked,
      includeLink: linkToggle.checked,
      includeAccount: accountToggle.checked
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      if (chrome.storage.sync) {
        chrome.storage.sync.set(newSettings);
      }
      if (chrome.storage.local) {
        chrome.storage.local.set(newSettings);
      }
    } else {
      try {
        localStorage.setItem('gemiboost_export_settings', JSON.stringify(newSettings));
      } catch (e) {}
    }
  };

  thoughtToggle.addEventListener('change', saveSettings);
  linkToggle.addEventListener('change', saveSettings);
  accountToggle.addEventListener('change', saveSettings);
});
