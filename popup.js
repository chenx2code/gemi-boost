// popup.js
// Handles reading and saving GemiBoost export preferences

const STORAGE_KEY = 'gemiboost_export_settings';
const DEFAULT_SETTINGS = {
  includeLink: false,
  includeAccount: false
};

document.addEventListener('DOMContentLoaded', () => {
  const linkToggle = document.getElementById('includeLink');
  const accountToggle = document.getElementById('includeAccount');

  // Load preferences from local storage cache
  const storage =
    typeof chrome !== 'undefined' && chrome.storage
      ? chrome.storage.local || chrome.storage.sync
      : null;

  if (storage) {
    storage.get([STORAGE_KEY, 'includeLink', 'includeAccount'], (res) => {
      let settings = DEFAULT_SETTINGS;
      if (res && res[STORAGE_KEY] && typeof res[STORAGE_KEY] === 'object') {
        settings = { ...DEFAULT_SETTINGS, ...res[STORAGE_KEY] };
      } else if (res) {
        settings = {
          includeLink: res.includeLink !== undefined ? !!res.includeLink : DEFAULT_SETTINGS.includeLink,
          includeAccount: res.includeAccount !== undefined ? !!res.includeAccount : DEFAULT_SETTINGS.includeAccount
        };
      }
      linkToggle.checked = !!settings.includeLink;
      accountToggle.checked = !!settings.includeAccount;
    });
  } else {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
      linkToggle.checked = !!items.includeLink;
      accountToggle.checked = !!items.includeAccount;
    } catch (e) {
      linkToggle.checked = DEFAULT_SETTINGS.includeLink;
      accountToggle.checked = DEFAULT_SETTINGS.includeAccount;
    }
  }

  // Save preferences on change to local cache
  const saveSettings = () => {
    const newSettings = {
      includeLink: linkToggle.checked,
      includeAccount: accountToggle.checked
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      const targetStorage = chrome.storage.local || chrome.storage.sync;
      targetStorage.set({ [STORAGE_KEY]: newSettings, ...newSettings }, () => {
        if (chrome.storage.sync && targetStorage !== chrome.storage.sync) {
          try {
            chrome.storage.sync.set({ [STORAGE_KEY]: newSettings, ...newSettings });
          } catch (e) {}
        }
      });
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      } catch (e) {}
    }
  };

  linkToggle.addEventListener('change', saveSettings);
  accountToggle.addEventListener('change', saveSettings);
});
