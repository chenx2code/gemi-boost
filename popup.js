// popup.js
// Handles reading, saving, and internationalizing GemiBoost settings in Google Material style

const CONFIG_SETTINGS = window.GemiBoost?.Config?.SETTINGS;
const STORAGE_KEY = CONFIG_SETTINGS?.STORAGE_KEY || 'gemiboost_export_settings';
const DEFAULT_SETTINGS = CONFIG_SETTINGS?.DEFAULTS || {
  includeLink: false,
  includeAccount: false,
  includeThinking: false
};

// UI localization strings
const I18N_STRINGS = {
  zh: {
    sectionTitle: '导出偏好',
    linkTitle: '包含对话链接',
    linkDesc: '导出 Markdown 时附带原始对话链接',
    accountTitle: '包含账号邮箱',
    accountDesc: '导出 Markdown 时附带当前账号信息',
    thinkingTitle: '包含思考过程',
    thinkingDesc: '导出 Task 模式或推理模型的思考链',
    obsidianSectionTitle: 'Obsidian 设置',
    obsidianPromptFolderTitle: '每次导出时选择文件夹',
    obsidianPromptFolderDesc: '点击导出时在页面中弹窗选择保存路径',
    obsidianFolderTitle: '默认存放文件夹',
    obsidianFolderDesc: '关闭上述选项时自动保存至此路径',
    obsidianVaultTitle: '指定 Vault 库名',
    obsidianVaultDesc: '留空则写入当前正在打开的库',
    autoSaveText: '更改已自动保存',
    savedFeedback: '设置已保存'
  },
  en: {
    sectionTitle: 'Export Preferences',
    linkTitle: 'Include conversation link',
    linkDesc: 'Add original chat link to Markdown export',
    accountTitle: 'Include account email',
    accountDesc: 'Add Google account email to Markdown header',
    thinkingTitle: 'Include thinking process',
    thinkingDesc: 'Export Task and reasoning thoughts',
    obsidianSectionTitle: 'Obsidian Settings',
    obsidianPromptFolderTitle: 'Ask folder before export',
    obsidianPromptFolderDesc: 'Prompt to choose a destination folder on each export',
    obsidianFolderTitle: 'Default target folder',
    obsidianFolderDesc: 'Used when the switch above is disabled',
    obsidianVaultTitle: 'Vault name',
    obsidianVaultDesc: 'Leave blank for active vault',
    autoSaveText: 'Changes saved automatically',
    savedFeedback: 'Settings saved'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const linkToggle = document.getElementById('includeLink');
  const accountToggle = document.getElementById('includeAccount');
  const thinkingToggle = document.getElementById('includeThinking');
  const versionChip = document.getElementById('versionChip');
  const sectionTitle = document.getElementById('sectionTitle');
  const linkTitle = document.getElementById('linkTitle');
  const linkDesc = document.getElementById('linkDesc');
  const accountTitle = document.getElementById('accountTitle');
  const accountDesc = document.getElementById('accountDesc');
  const thinkingTitle = document.getElementById('thinkingTitle');
  const thinkingDesc = document.getElementById('thinkingDesc');
  const obsidianSectionTitle = document.getElementById('obsidianSectionTitle');
  const obsidianPromptFolder = document.getElementById('obsidianPromptFolder');
  const obsidianPromptFolderTitle = document.getElementById('obsidianPromptFolderTitle');
  const obsidianPromptFolderDesc = document.getElementById('obsidianPromptFolderDesc');
  const obsidianFolderRow = document.getElementById('obsidianFolderRow');
  const obsidianFolder = document.getElementById('obsidianFolder');
  const obsidianFolderTitle = document.getElementById('obsidianFolderTitle');
  const obsidianFolderDesc = document.getElementById('obsidianFolderDesc');
  const obsidianVault = document.getElementById('obsidianVault');
  const obsidianVaultTitle = document.getElementById('obsidianVaultTitle');
  const obsidianVaultDesc = document.getElementById('obsidianVaultDesc');
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
  if (thinkingTitle) thinkingTitle.textContent = strings.thinkingTitle;
  if (thinkingDesc) thinkingDesc.textContent = strings.thinkingDesc;
  if (obsidianSectionTitle) obsidianSectionTitle.textContent = strings.obsidianSectionTitle;
  if (obsidianPromptFolderTitle) obsidianPromptFolderTitle.textContent = strings.obsidianPromptFolderTitle;
  if (obsidianPromptFolderDesc) obsidianPromptFolderDesc.textContent = strings.obsidianPromptFolderDesc;
  if (obsidianFolderTitle) obsidianFolderTitle.textContent = strings.obsidianFolderTitle;
  if (obsidianFolderDesc) obsidianFolderDesc.textContent = strings.obsidianFolderDesc;
  if (obsidianVaultTitle) obsidianVaultTitle.textContent = strings.obsidianVaultTitle;
  if (obsidianVaultDesc) obsidianVaultDesc.textContent = strings.obsidianVaultDesc;
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

  // Material Design 3 disabled state handler for dependent target folder field
  const updateFolderRowDisabledState = (isPromptMode) => {
    if (obsidianFolderRow && obsidianFolder) {
      if (isPromptMode) {
        obsidianFolderRow.classList.add('is-disabled');
        obsidianFolder.disabled = true;
      } else {
        obsidianFolderRow.classList.remove('is-disabled');
        obsidianFolder.disabled = false;
      }
    }
  };

  // Populate UI inputs from settings object
  const applySettingsToUI = (settings) => {
    if (linkToggle) linkToggle.checked = !!settings.includeLink;
    if (accountToggle) accountToggle.checked = !!settings.includeAccount;
    if (thinkingToggle) thinkingToggle.checked = !!settings.includeThinking;
    const isPrompt = !!settings.obsidianPromptFolder;
    if (obsidianPromptFolder) obsidianPromptFolder.checked = isPrompt;
    if (obsidianFolder) obsidianFolder.value = settings.obsidianFolder || DEFAULT_SETTINGS.obsidianFolder || 'Gemini';
    if (obsidianVault) obsidianVault.value = settings.obsidianVault || '';
    updateFolderRowDisabledState(isPrompt);
  };

  // Load preferences from local storage cache
  const storage =
    typeof chrome !== 'undefined' && chrome.storage
      ? chrome.storage.local || chrome.storage.sync
      : null;

  if (storage) {
    storage.get([STORAGE_KEY, 'includeLink', 'includeAccount', 'includeThinking', 'obsidianFolder', 'obsidianVault', 'obsidianPromptFolder'], (res) => {
      let settings = DEFAULT_SETTINGS;
      if (res && res[STORAGE_KEY] && typeof res[STORAGE_KEY] === 'object') {
        settings = { ...DEFAULT_SETTINGS, ...res[STORAGE_KEY] };
      } else if (res) {
        settings = {
          includeLink: res.includeLink !== undefined ? !!res.includeLink : DEFAULT_SETTINGS.includeLink,
          includeAccount: res.includeAccount !== undefined ? !!res.includeAccount : DEFAULT_SETTINGS.includeAccount,
          includeThinking: res.includeThinking !== undefined ? !!res.includeThinking : DEFAULT_SETTINGS.includeThinking,
          obsidianFolder: res.obsidianFolder !== undefined ? String(res.obsidianFolder) : DEFAULT_SETTINGS.obsidianFolder,
          obsidianVault: res.obsidianVault !== undefined ? String(res.obsidianVault) : DEFAULT_SETTINGS.obsidianVault,
          obsidianPromptFolder: res.obsidianPromptFolder !== undefined ? !!res.obsidianPromptFolder : DEFAULT_SETTINGS.obsidianPromptFolder
        };
      }
      applySettingsToUI(settings);
    });
  } else {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : DEFAULT_SETTINGS;
      applySettingsToUI(items);
    } catch (e) {
      applySettingsToUI(DEFAULT_SETTINGS);
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
      includeAccount: accountToggle ? accountToggle.checked : false,
      includeThinking: thinkingToggle ? thinkingToggle.checked : false,
      obsidianPromptFolder: obsidianPromptFolder ? obsidianPromptFolder.checked : false,
      obsidianFolder: obsidianFolder ? obsidianFolder.value.trim() || 'Gemini' : 'Gemini',
      obsidianVault: obsidianVault ? obsidianVault.value.trim() : ''
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
  if (thinkingToggle) thinkingToggle.addEventListener('change', saveSettings);
  if (obsidianPromptFolder) {
    obsidianPromptFolder.addEventListener('change', () => {
      updateFolderRowDisabledState(obsidianPromptFolder.checked);
      saveSettings();
    });
  }
  if (obsidianFolder) {
    obsidianFolder.addEventListener('change', saveSettings);
    obsidianFolder.addEventListener('blur', saveSettings);
  }
  if (obsidianVault) {
    obsidianVault.addEventListener('change', saveSettings);
    obsidianVault.addEventListener('blur', saveSettings);
  }
});
