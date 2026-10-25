// content-storage.js
// Handles persistent storage and cache merging logic for GemiBoost

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Storage = {
  // Check if extension context is valid (not invalidated due to reload)
  isContextValid: function () {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
    } catch (e) {
      return false;
    }
  },

  // Load cached chat TOC from chrome.storage.local or localStorage
  loadChatCache: function (chatId, callback) {
    if (!chatId) return callback(null);
    const key = `gemiboost_chat_${chatId}`;

    const handleResult = (cached) => {
      if (cached) {
        if (cached.version !== GemiBoost.Config.CACHE_VERSION) {
          // Invalidate legacy or unversioned cache
          this.clearChatCache(chatId);
          return callback(null);
        }
        return callback(cached);
      }
      callback(null);
    };

    if (this.isContextValid()) {
      try {
        chrome.storage.local.get([key], (res) => {
          handleResult(res ? res[key] : null);
        });
      } catch (e) {
        try {
          const raw = localStorage.getItem(key);
          handleResult(raw ? JSON.parse(raw) : null);
        } catch (err) {
          callback(null);
        }
      }
    } else {
      try {
        const raw = localStorage.getItem(key);
        handleResult(raw ? JSON.parse(raw) : null);
      } catch (e) {
        callback(null);
      }
    }
  },

  // Save chat TOC data to persistent storage
  saveChatCache: function (chatId, items, isFullySynced = false) {
    if (!chatId || !items || items.length === 0) return;
    const key = `gemiboost_chat_${chatId}`;
    const data = {
      version: GemiBoost.Config.CACHE_VERSION,
      items: items.map((it) => ({
        type: it.type,
        display: it.display,
        title: it.title || '',
        className: it.className,
        queryIndex: it.queryIndex,
        subIndex: it.subIndex,
        rawText: it.rawText || ''
      })),
      isFullySynced: !!isFullySynced,
      updatedAt: Date.now()
    };

    if (this.isContextValid()) {
      try {
        chrome.storage.local.set({ [key]: data });
      } catch (e) {
        try {
          localStorage.setItem(key, JSON.stringify(data));
        } catch (err) {}
      }
    } else {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {}
    }
  },

  // Remove cache for a specific chat ID
  clearChatCache: function (chatId, callback) {
    if (!chatId) {
      if (callback) callback();
      return;
    }
    const key = `gemiboost_chat_${chatId}`;
    if (this.isContextValid()) {
      try {
        chrome.storage.local.remove([key], () => {
          if (callback) callback();
        });
      } catch (e) {
        try {
          localStorage.removeItem(key);
        } catch (err) {}
        if (callback) callback();
      }
    } else {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
      if (callback) callback();
    }
  },

  // Merge live DOM items with cached items to maintain proper chronological order
  mergeWithCache: function (domItems, cachedData) {
    const cachedItems = cachedData?.items || [];
    const isFullySynced = !!cachedData?.isFullySynced;

    if (!cachedItems || cachedItems.length === 0) {
      return { items: domItems, hasChanges: false, isCorrupted: false };
    }
    if (!domItems || domItems.length === 0) {
      return { items: cachedItems, hasChanges: false, isCorrupted: false };
    }

    const isMatch = (a, b) =>
      a.type === b.type &&
      a.rawText === b.rawText &&
      (a.subIndex === b.subIndex || (a.subIndex === undefined && b.subIndex === undefined));

    // Validate relative order of cachedItems against domItems
    // domItems reflects the ground-truth top-to-bottom order from the DOM
    let lastFoundIndex = -1;
    let isCorrupted = false;

    for (const d of domItems) {
      const idx = cachedItems.findIndex((c) => isMatch(c, d));
      if (idx !== -1) {
        if (idx < lastFoundIndex) {
          isCorrupted = true;
          break;
        }
        lastFoundIndex = idx;
      }
    }

    if (isCorrupted) {
      console.warn('[GemiBoost] Detected out-of-order cached items. Resetting cache to restore DOM order.');
      const chatId = GemiBoost.Utils.getChatId();
      if (chatId) this.clearChatCache(chatId);
      return { items: domItems, hasChanges: false, isCorrupted: true };
    }

    // Only merge with cached items if the cache is marked as fully synced
    if (isFullySynced) {
      let firstDomMatch = -1;
      let lastDomMatch = -1;

      for (let i = 0; i < domItems.length; i++) {
        const d = domItems[i];
        const inCache = cachedItems.some((c) => isMatch(c, d));
        if (inCache) {
          if (firstDomMatch === -1) firstDomMatch = i;
          lastDomMatch = i;
        }
      }

      let updated = [...cachedItems];
      let hasChanges = false;

      // 1. Prepend historical items loaded at the top
      if (firstDomMatch > 0) {
        const prepended = domItems.slice(0, firstDomMatch);
        updated = [...prepended, ...updated];
        hasChanges = true;
      }

      // 2. Append new user messages sent at the bottom
      if (lastDomMatch !== -1 && lastDomMatch < domItems.length - 1) {
        const appended = domItems.slice(lastDomMatch + 1);
        updated = [...updated, ...appended];
        hasChanges = true;
      }

      // 3. Fallback: If user typed a new message when no items matched
      if (firstDomMatch === -1 && domItems.length > 0) {
        const lastDom = domItems[domItems.length - 1];
        if (!cachedItems.some((c) => isMatch(c, lastDom))) {
          updated = [...cachedItems, lastDom];
          hasChanges = true;
        }
      }

      const domSet = new Set(domItems.map((d) => `${d.type}:${d.rawText}:${d.subIndex ?? ''}`));
      const finalItems = updated.map((c) => ({
        ...c,
        isOffDOM: !domSet.has(`${c.type}:${c.rawText}:${c.subIndex ?? ''}`)
      }));

      return { items: finalItems, hasChanges, updatedList: updated, isCorrupted: false };
    }

    // If cache is not fully synced, DOM is the authoritative source
    return { items: domItems, hasChanges: false, isCorrupted: false };
  },

  STORAGE_KEY_SETTINGS: GemiBoost.Config.SETTINGS.STORAGE_KEY,

  // Default export preferences
  DEFAULT_EXPORT_SETTINGS: GemiBoost.Config.SETTINGS.DEFAULTS,

  // Load export settings from local cache (chrome.storage.local)
  loadExportSettings: function (callback) {
    const defaults = this.DEFAULT_EXPORT_SETTINGS;
    const key = this.STORAGE_KEY_SETTINGS;

    if (this.isContextValid()) {
      try {
        const storage = chrome.storage.local || chrome.storage.sync;
        storage.get([key, 'includeLink', 'includeAccount'], (res) => {
          if (!res) return callback(defaults);
          if (res[key] && typeof res[key] === 'object') {
            return callback({ ...defaults, ...res[key] });
          }
          const settings = {
            includeLink: res.includeLink !== undefined ? !!res.includeLink : defaults.includeLink,
            includeAccount: res.includeAccount !== undefined ? !!res.includeAccount : defaults.includeAccount
          };
          callback(settings);
        });
      } catch (e) {
        try {
          const raw = localStorage.getItem(key);
          callback(raw ? { ...defaults, ...JSON.parse(raw) } : defaults);
        } catch (err) {
          callback(defaults);
        }
      }
    } else {
      try {
        const raw = localStorage.getItem(key);
        callback(raw ? { ...defaults, ...JSON.parse(raw) } : defaults);
      } catch (e) {
        callback(defaults);
      }
    }
  },

  // Save export settings to local cache (chrome.storage.local)
  saveExportSettings: function (settings, callback) {
    const key = this.STORAGE_KEY_SETTINGS;
    const toSave = {
      includeLink: !!settings.includeLink,
      includeAccount: !!settings.includeAccount
    };

    if (this.isContextValid()) {
      try {
        const storage = chrome.storage.local || chrome.storage.sync;
        storage.set({ [key]: toSave, ...toSave }, () => {
          if (chrome.storage.sync && storage !== chrome.storage.sync) {
            try {
              chrome.storage.sync.set({ [key]: toSave, ...toSave });
            } catch (e) {}
          }
          if (callback) callback();
        });
      } catch (e) {
        try {
          localStorage.setItem(key, JSON.stringify(toSave));
        } catch (err) {}
        if (callback) callback();
      }
    } else {
      try {
        localStorage.setItem(key, JSON.stringify(toSave));
      } catch (e) {}
      if (callback) callback();
    }
  }
};
