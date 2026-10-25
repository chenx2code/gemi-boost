// popup.js
// Handles reading, saving, and internationalizing GemiBoost settings in Google Material style

const CONFIG_SETTINGS = window.GemiBoost?.Config?.SETTINGS;
const STORAGE_KEY = CONFIG_SETTINGS?.STORAGE_KEY || 'gemiboost_export_settings';
const DEFAULT_SETTINGS = CONFIG_SETTINGS?.DEFAULTS || {
  includeLink: false,
  includeAccount: false
};

// UI localization strings
const I18N_STRINGS = {
  zh: {
    sectionTitle: '导出偏好',
    linkTitle: '包含对话链接',
    linkDesc: '导出 Markdown 时附带原始对话链接',
    accountTitle: '包含账号邮箱',
    accountDesc: '导出 Markdown 时附带当前账号信息',
    autoSaveText: '更改已自动保存',
    savedFeedback: '设置已保存'
  },
  en: {
    sectionTitle: 'Export Preferences',
    linkTitle: 'Include conversation link',
    linkDesc: 'Add original chat link to Markdown export',
    accountTitle: 'Include account email',
    accountDesc: 'Add Google account email to Markdown header',
    autoSaveText: 'Changes saved automatically',
    savedFeedback: 'Settings saved'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const linkToggle = document.getElementById('includeLink');
  const accountToggle = document.getElementById('includeAccount');
  const versionChip = document.getElementById('versionChip');
  const sectionTitle = document.getElementById('sectionTitle');
  const linkTitle = document.getElementById('linkTitle');
  const linkDesc = document.getElementById('linkDesc');
  const accountTitle = document.getElementById('accountTitle');
  const accountDesc = document.getElementById('accountDesc');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');

  // Detect language and apply localization
  let isChinese = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      isChinese = navigator.language.toLowerCase().startsWith('zh');
    }
    if (!isChinese && typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.i18n?.getUILanguage) {
      isChinese = chrome.i18n.getUILanguage().toLowerCase().startsWith('zh');
    }
  } catch (e) {
    isChinese = (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('zh')) || false;
  }
  const strings = isChinese ? I18N_STRINGS.zh : I18N_STRINGS.en;

  if (sectionTitle) sectionTitle.textContent = strings.sectionTitle;
  if (linkTitle) linkTitle.textContent = strings.linkTitle;
  if (linkDesc) linkDesc.textContent = strings.linkDesc;
  if (accountTitle) accountTitle.textContent = strings.accountTitle;
  if (accountDesc) accountDesc.textContent = strings.accountDesc;
  if (statusText) statusText.textContent = strings.autoSaveText;

  // Retrieve version dynamically from extension manifest
  if (versionChip) {
    try {
      const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : null;
      if (manifest && manifest.version) {
        versionChip.textContent = `v${manifest.version}`;
      }
    } catch (e) {
      // Fallback kept from HTML
    }
  }

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
      if (linkToggle) linkToggle.checked = !!settings.includeLink;
      if (accountToggle) accountToggle.checked = !!settings.includeAccount;
    });
  } else {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
      if (linkToggle) linkToggle.checked = !!items.includeLink;
      if (accountToggle) accountToggle.checked = !!items.includeAccount;
    } catch (e) {
      if (linkToggle) linkToggle.checked = DEFAULT_SETTINGS.includeLink;
      if (accountToggle) accountToggle.checked = DEFAULT_SETTINGS.includeAccount;
    }
  }

  // Save feedback timer handle
  let feedbackTimer = null;

  const showSavedFeedback = () => {
    if (!statusIndicator || !statusText) return;
    statusIndicator.classList.add('saved');
    statusText.textContent = strings.savedFeedback;

    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      statusIndicator.classList.remove('saved');
      statusText.textContent = strings.autoSaveText;
    }, 1500);
  };

  // Save preferences on change
  const saveSettings = () => {
    const newSettings = {
      includeLink: linkToggle ? linkToggle.checked : false,
      includeAccount: accountToggle ? accountToggle.checked : false
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      const targetStorage = chrome.storage.local || chrome.storage.sync;
      targetStorage.set({ [STORAGE_KEY]: newSettings, ...newSettings }, () => {
        if (chrome.storage.sync && targetStorage !== chrome.storage.sync) {
          try {
            chrome.storage.sync.set({ [STORAGE_KEY]: newSettings, ...newSettings });
          } catch (e) {}
        }
        showSavedFeedback();
      });
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      } catch (e) {}
      showSavedFeedback();
    }
  };

  if (linkToggle) linkToggle.addEventListener('change', saveSettings);
  if (accountToggle) accountToggle.addEventListener('change', saveSettings);
});
