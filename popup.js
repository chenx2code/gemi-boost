// popup.js
// Handles reading and saving GemiBoost export preferences

const DEFAULT_SETTINGS = {
  includeLink: true,
  includeAccount: false
};

document.addEventListener('DOMContentLoaded', () => {
  const linkToggle = document.getElementById('includeLink');
  const accountToggle = document.getElementById('includeAccount');

  // Load preferences from chrome.storage
  const storage =
    typeof chrome !== 'undefined' && chrome.storage
      ? chrome.storage.sync || chrome.storage.local
      : null;

  if (storage) {
    storage.get(DEFAULT_SETTINGS, (items) => {
      linkToggle.checked = items.includeLink !== false;
      accountToggle.checked = !!items.includeAccount;
    });
  } else {
    try {
      const raw = localStorage.getItem('gemiboost_export_settings');
      const items = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
      linkToggle.checked = items.includeLink !== false;
      accountToggle.checked = !!items.includeAccount;
    } catch (e) {
      linkToggle.checked = DEFAULT_SETTINGS.includeLink;
      accountToggle.checked = DEFAULT_SETTINGS.includeAccount;
    }
  }

  // Save preferences on change
  const saveSettings = () => {
    const newSettings = {
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

  linkToggle.addEventListener('change', saveSettings);
  accountToggle.addEventListener('change', saveSettings);
});
