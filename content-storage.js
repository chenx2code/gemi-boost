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
        if (Array.isArray(cached.items)) {
          // Auto-heal isTurnRoot if missing from legacy cached chats
          let lastQueryIndex = null;
          cached.items.forEach((it, idx) => {
            if (typeof it.isTurnRoot !== 'boolean') {
              const qIdx = it.queryIndex !== undefined ? it.queryIndex : idx;
              it.isTurnRoot = (qIdx !== lastQueryIndex);
            }
            if (it.isTurnRoot) {
              lastQueryIndex = it.queryIndex !== undefined ? it.queryIndex : idx;
            }
          });
          cached.items = this.normalizeItems(cached.items);
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

  // Normalize items to ensure globally contiguous queryIndex for every turn
  normalizeItems: function (items) {
    if (!items || items.length === 0) return [];
    let currentTurn = -1;
    return items.map((it) => {
      const isTurnRoot = it.isTurnRoot !== false;
      if (isTurnRoot) {
        currentTurn++;
      }
      return {
        ...it,
        queryIndex: currentTurn >= 0 ? currentTurn : 0
      };
    });
  },

  // Save chat TOC data to persistent storage
  saveChatCache: function (chatId, items, isFullySynced = false) {
    if (!chatId || !items || items.length === 0) return;
    const normalized = this.normalizeItems(items);
    const key = `gemiboost_chat_${chatId}`;
    const data = {
      version: GemiBoost.Config.CACHE_VERSION,
      items: normalized.map((it) => ({
        type: it.type,
        isTurnRoot: it.isTurnRoot !== false,
        display: it.display,
        title: it.title || '',
        className: it.className,
        queryIndex: it.queryIndex,
        subIndex: it.subIndex,
        rawText: it.rawText || '',
        fileType: it.fileType || '',
        fileCategory: it.fileCategory || '',
        fileName: it.fileName || '',
        isDefaultName: !!it.isDefaultName,
        imageIndex: it.imageIndex !== undefined ? it.imageIndex : undefined,
        totalImages: it.totalImages !== undefined ? it.totalImages : undefined
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

    // Sequential forward alignment tolerating repeated prompts (e.g. "Continue", empty image turns)
    const isMatch = (a, b) =>
      a.type === b.type &&
      a.rawText === b.rawText &&
      (a.subIndex === b.subIndex || (a.subIndex === undefined && b.subIndex === undefined));

    const matchDomToCache = (domList, cacheList) => {
      const mapping = new Array(domList.length).fill(-1);
      if (domList.length === 0 || cacheList.length === 0) return { mapping, isCorrupted: false };

      // Check forward monotonic alignment across possible starting offsets in cache
      const firstDom = domList[0];
      const startCandidates = [];
      for (let ci = 0; ci < cacheList.length; ci++) {
        if (isMatch(cacheList[ci], firstDom)) {
          startCandidates.push(ci);
        }
      }
      if (startCandidates.length === 0) {
        startCandidates.push(0);
      }

      let bestMapping = null;
      let bestMatchCount = -1;
      let anyValidOrder = false;

      for (const startIdx of startCandidates) {
        const candidateMap = new Array(domList.length).fill(-1);
        let cursor = startIdx;
        let matchCount = 0;

        for (let di = 0; di < domList.length; di++) {
          const d = domList[di];
          let found = -1;
          for (let ci = cursor; ci < cacheList.length; ci++) {
            if (isMatch(cacheList[ci], d)) {
              found = ci;
              break;
            }
          }
          if (found !== -1) {
            candidateMap[di] = found;
            cursor = found + 1;
            matchCount++;
          }
        }

        // Verify matched items never collide out-of-order against unmatched earlier cache entries
        if (matchCount > bestMatchCount) {
          bestMatchCount = matchCount;
          bestMapping = candidateMap;
        }
        if (matchCount === domList.length) {
          anyValidOrder = true;
          break;
        }
      }

      if (!anyValidOrder && bestMapping) {
        // Detect genuine out-of-order corruption inside matched cache range without false positives on newly appended repeated prompts
        let firstMatchedDom = -1;
        let lastMatchedDom = -1;
        let firstMatchedCacheIdx = -1;
        let lastMatchedCacheIdx = -1;
        const matchedCacheSet = new Set();

        for (let di = 0; di < domList.length; di++) {
          const ci = bestMapping[di];
          if (ci !== -1) {
            if (firstMatchedDom === -1) {
              firstMatchedDom = di;
              firstMatchedCacheIdx = ci;
            }
            lastMatchedDom = di;
            lastMatchedCacheIdx = ci;
            matchedCacheSet.add(ci);
          }
        }

        if (firstMatchedDom !== -1) {
          let prevCacheIdx = -1;
          for (let di = 0; di < domList.length; di++) {
            const ci = bestMapping[di];
            if (ci !== -1) {
              prevCacheIdx = ci;
              continue;
            }
            // Case 1: Interior unmatched DOM item exists strictly before current matched cursor
            if (di > firstMatchedDom && di < lastMatchedDom && prevCacheIdx !== -1) {
              const earlierIdx = cacheList.findIndex((c, idx) => idx < prevCacheIdx && !matchedCacheSet.has(idx) && isMatch(c, domList[di]));
              if (earlierIdx !== -1) {
                return { mapping: bestMapping, isCorrupted: true };
              }
            }
            // Case 2: Unmatched DOM item corresponds to an unmatched cache item skipped strictly inside [firstMatchedCacheIdx, lastMatchedCacheIdx]
            if (di > firstMatchedDom) {
              const skippedInteriorIdx = cacheList.findIndex(
                (c, idx) => idx > firstMatchedCacheIdx && idx < lastMatchedCacheIdx && !matchedCacheSet.has(idx) && isMatch(c, domList[di])
              );
              if (skippedInteriorIdx !== -1) {
                return { mapping: bestMapping, isCorrupted: true };
              }
            }
          }
        }
      }

      return { mapping: bestMapping || mapping, isCorrupted: false };
    };

    const initialAlignment = matchDomToCache(domItems, cachedItems);
    if (initialAlignment.isCorrupted) {
      console.warn('[GemiBoost] Detected out-of-order cached items. Resetting cache to restore DOM order.');
      const chatId = GemiBoost.Utils.getChatId();
      if (chatId) this.clearChatCache(chatId);
      return { items: domItems, hasChanges: false, isCorrupted: true };
    }

    // Only merge with cached items if the cache is marked as fully synced
    if (isFullySynced) {
      let firstDomMatch = -1;
      let lastDomMatch = -1;
      const domToCacheIdx = initialAlignment.mapping;

      for (let i = 0; i < domItems.length; i++) {
        if (domToCacheIdx[i] !== -1) {
          if (firstDomMatch === -1) firstDomMatch = i;
          lastDomMatch = i;
        }
      }

      let updated = [...cachedItems];
      let hasChanges = false;
      let prependedCount = 0;

      // 1. Prepend historical items loaded at the top
      if (firstDomMatch > 0) {
        const prepended = domItems.slice(0, firstDomMatch);
        prependedCount = prepended.length;
        updated = [...prepended, ...updated];
        hasChanges = true;
      }

      // 2. Append new user messages sent at the bottom
      if (lastDomMatch !== -1 && lastDomMatch < domItems.length - 1) {
        const appended = domItems.slice(lastDomMatch + 1);
        updated = [...updated, ...appended];
        hasChanges = true;
      }

      // 3. Fallback: If no DOM items matched cached items, append all new items
      if (firstDomMatch === -1 && domItems.length > 0) {
        const usedCacheIdx = new Set();
        const newItems = domItems.filter((d) => {
          const found = cachedItems.findIndex((c, idx) => !usedCacheIdx.has(idx) && isMatch(c, d));
          if (found !== -1) {
            usedCacheIdx.add(found);
            return false;
          }
          return true;
        });
        if (newItems.length > 0) {
          updated = [...cachedItems, ...newItems];
          hasChanges = true;
        }
      }

      // Upgrade matched image and file items when live DOM resolves a fuller filename
      const stripKnownPrefix = (name, typeTag) => {
        if (!name || !typeTag) return name;
        const prefix = typeTag + ' ';
        if (name.toUpperCase().startsWith(prefix.toUpperCase())) {
          return name.slice(prefix.length).trim();
        }
        return name;
      };

      const matchedCacheIndicesForDom = new Set();
      for (let di = 0; di < domItems.length; di++) {
        const d = domItems[di];
        let idx = domToCacheIdx[di] !== -1 ? domToCacheIdx[di] + prependedCount : -1;
        if (idx === -1 && lastDomMatch !== -1 && di > lastDomMatch) {
          const appendedPos = cachedItems.length + prependedCount + (di - lastDomMatch - 1);
          if (appendedPos < updated.length && isMatch(updated[appendedPos], d)) {
            idx = appendedPos;
          }
        }
        if (idx === -1 && firstDomMatch > 0 && di < firstDomMatch) {
          if (di < updated.length && isMatch(updated[di], d)) {
            idx = di;
          }
        }
        if (idx !== -1 && idx < updated.length) {
          matchedCacheIndicesForDom.add(idx);
          const c = updated[idx];
          const shouldUpgradeImage =
            c.type === 'image' &&
            d.type === 'image' &&
            c.isDefaultName &&
            !d.isDefaultName;

          const isQuotePair =
            c.fileCategory === 'quote' ||
            d.fileCategory === 'quote' ||
            c.fileType === 'Quote' ||
            d.fileType === 'Quote';

          let shouldUpgradeFile = false;
          if (!isQuotePair && c.type === 'file' && d.type === 'file' && c.fileName && d.fileName && d.fileName !== c.fileName) {
            const cLower = c.fileName.toLowerCase();
            const dLower = d.fileName.toLowerCase();
            const cHasExt = /\.[a-zA-Z0-9]{1,10}$/.test(c.fileName);
            const dHasExt = /\.[a-zA-Z0-9]{1,10}$/.test(d.fileName);
            const cCleanLower = stripKnownPrefix(c.fileName, c.fileType).toLowerCase();
            const cTruncPrefix = cLower.replace(/[.\u2026]+$/, '');
            const dBaseLower = dLower.replace(/\.[^.]+$/, '');

            if (!cHasExt && dHasExt) {
              shouldUpgradeFile =
                dLower.startsWith(cLower + '.') ||
                dLower.startsWith(cCleanLower + '.') ||
                ((c.fileName.endsWith('...') || c.fileName.endsWith('…')) && cTruncPrefix.length >= 3 && dBaseLower.startsWith(cTruncPrefix));
            } else if (!cHasExt && !dHasExt && cCleanLower !== cLower && dLower === cCleanLower) {
              shouldUpgradeFile = true;
            }
          }

          if (shouldUpgradeImage || shouldUpgradeFile) {
            updated[idx] = {
              ...c,
              fileType: d.fileType,
              fileCategory: d.fileCategory || c.fileCategory,
              fileName: d.fileName,
              display: d.display,
              title: d.title,
              isDefaultName: false,
              imageIndex: d.imageIndex,
              totalImages: d.totalImages
            };
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        updated = this.normalizeItems(updated);
      }

      const finalItems = updated.map((c, idx) => ({
        ...c,
        isOffDOM: !matchedCacheIndicesForDom.has(idx)
      }));

      return { items: this.normalizeItems(finalItems), hasChanges, updatedList: updated, isCorrupted: false };
    }

    // If cache is not fully synced, DOM is the authoritative source
    return { items: this.normalizeItems(domItems), hasChanges: false, isCorrupted: false };
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
        storage.get([key, 'includeLink', 'includeAccount', 'includeThinking', 'includePromptNumber', 'enableNotifications', 'obsidianFolder', 'obsidianVault', 'obsidianSilent', 'obsidianPromptFolder', 'obsidianFolderHistory'], (res) => {
          if (!res) return callback(defaults);
          if (res[key] && typeof res[key] === 'object') {
            return callback({ ...defaults, ...res[key] });
          }
          const settings = {
            includeLink: res.includeLink !== undefined ? !!res.includeLink : defaults.includeLink,
            includeAccount: res.includeAccount !== undefined ? !!res.includeAccount : defaults.includeAccount,
            includeThinking: res.includeThinking !== undefined ? !!res.includeThinking : defaults.includeThinking,
            includePromptNumber: res.includePromptNumber !== undefined ? !!res.includePromptNumber : defaults.includePromptNumber,
            enableNotifications: res.enableNotifications !== undefined ? !!res.enableNotifications : defaults.enableNotifications,
            obsidianFolder: res.obsidianFolder !== undefined ? String(res.obsidianFolder) : defaults.obsidianFolder,
            obsidianVault: res.obsidianVault !== undefined ? String(res.obsidianVault) : defaults.obsidianVault,
            obsidianSilent: res.obsidianSilent !== undefined ? !!res.obsidianSilent : defaults.obsidianSilent,
            obsidianPromptFolder: res.obsidianPromptFolder !== undefined ? !!res.obsidianPromptFolder : defaults.obsidianPromptFolder,
            obsidianFolderHistory: Array.isArray(res.obsidianFolderHistory) ? res.obsidianFolderHistory : defaults.obsidianFolderHistory
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
      includeAccount: !!settings.includeAccount,
      includeThinking: !!settings.includeThinking,
      includePromptNumber: settings.includePromptNumber !== undefined ? !!settings.includePromptNumber : true,
      enableNotifications: settings.enableNotifications !== undefined ? !!settings.enableNotifications : true,
      obsidianFolder: settings.obsidianFolder !== undefined ? String(settings.obsidianFolder) : 'Gemini',
      obsidianVault: settings.obsidianVault !== undefined ? String(settings.obsidianVault) : '',
      obsidianSilent: settings.obsidianSilent !== undefined ? !!settings.obsidianSilent : true,
      obsidianPromptFolder: settings.obsidianPromptFolder !== undefined ? !!settings.obsidianPromptFolder : false,
      obsidianFolderHistory: Array.isArray(settings.obsidianFolderHistory) ? settings.obsidianFolderHistory : ['Gemini']
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
  },

  // Record a folder to recent history (up to 5 folders, deduplicated)
  addObsidianFolderHistory: function (folder, callback) {
    if (!folder || typeof folder !== 'string') {
      if (callback) callback();
      return;
    }
    const cleanFolder = folder.trim().replace(/^[\/\\\\]+|[\/\\\\]+$/g, '');
    if (!cleanFolder) {
      if (callback) callback();
      return;
    }

    this.loadExportSettings((settings) => {
      let history = Array.isArray(settings.obsidianFolderHistory) ? settings.obsidianFolderHistory.slice() : ['Gemini'];
      // Filter out existing and put to front
      history = [cleanFolder, ...history.filter((f) => f.toLowerCase() !== cleanFolder.toLowerCase())].slice(0, 5);
      settings.obsidianFolderHistory = history;
      this.saveExportSettings(settings, callback);
    });
  }
};
