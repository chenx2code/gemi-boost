// content-catalog.js
// Handles Table of Contents (TOC) logic for Gemini Web

const Catalog = {
  containerId: 'gemiboost-toc-container',
  toggleBtnId: 'gemiboost-toc-toggle',
  syncBtnId: 'gemiboost-toc-sync-btn',
  isCatalogOpen: false,
  isSyncing: false,
  abortSync: false,
  lastQueryCount: 0,
  lastSignature: '',
  initAttempts: 0,
  currentUrl: location.href,
  cachedChatData: null,
  lastExtractedData: [],

  init: function () {
    this.tryInjectUI();
  },

  getChatId: function () {
    const match = location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  },

  loadChatCache: function (chatId, callback) {
    if (!chatId) return callback(null);
    const key = `gemiboost_chat_${chatId}`;
    const handleResult = (cached) => {
      if (cached) {
        if (cached.version !== 2) {
          // Invalidate legacy unversioned cache that may contain corrupted ordering
          this.clearChatCache(chatId);
          return callback(null);
        }
        return callback(cached);
      }
      callback(null);
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (res) => {
        handleResult(res ? res[key] : null);
      });
    } else {
      try {
        const raw = localStorage.getItem(key);
        handleResult(raw ? JSON.parse(raw) : null);
      } catch (e) {
        callback(null);
      }
    }
  },

  saveChatCache: function (chatId, items, isFullySynced = false) {
    if (!chatId || !items || items.length === 0) return;
    const key = `gemiboost_chat_${chatId}`;
    const data = {
      version: 2,
      items: items.map(it => ({
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
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: data });
    } else {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {}
    }
  },

  clearChatCache: function (chatId, callback) {
    if (!chatId) {
      if (callback) callback();
      return;
    }
    const key = `gemiboost_chat_${chatId}`;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove([key], () => {
        if (callback) callback();
      });
    } else {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
      if (callback) callback();
    }
  },

  getChatScrollContainer: function () {
    const uq = document.querySelector('user-query');
    if (uq) {
      let p = uq.parentElement;
      while (p && p !== document.body) {
        const s = window.getComputedStyle(p);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.scrollHeight > p.clientHeight) {
          return p;
        }
        p = p.parentElement;
      }
    }
    return document.querySelector('infinite-scroller[data-test-id="chat-history-container"]')
      || document.querySelector('infinite-scroller.chat-history')
      || document.documentElement;
  },

  getFirstQueryText: function () {
    const first = document.querySelector('user-query');
    if (!first) return '';
    const textNode = first.querySelector('.query-text, p.query-text-line, .query-content') || first;
    return textNode.textContent.trim().slice(0, 40);
  },

  triggerHistorySync: async function () {
    if (this.isSyncing) {
      // If clicked while already syncing, cancel the ongoing sync loop
      this.abortSync = true;
      return;
    }
    const chatId = this.getChatId();
    const scroller = this.getChatScrollContainer();
    if (!scroller) return;

    this.isSyncing = true;
    this.abortSync = false;

    // CRITICAL: Every refresh is a clean force-refresh!
    // 1. Reset memory cache and signatures so re-rendering is never blocked
    this.cachedChatData = null;
    this.lastSignature = '';
    this.lastQueryCount = 0;

    // 2. Wipe old persistent cache for this chat immediately
    if (chatId) {
      this.clearChatCache(chatId);
    }

    const syncBtn = document.getElementById(this.syncBtnId);
    if (syncBtn) {
      syncBtn.classList.remove('is-synced');
      syncBtn.classList.add('is-syncing');
      syncBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
        </svg>
        <span>同步中</span>
      `;
      syncBtn.setAttribute('title', '正在加载全部历史记录... (再次点击可取消)');
    }

    let prevCount = document.querySelectorAll('user-query').length;
    let prevFirstSig = this.getFirstQueryText();
    let prevScrollHeight = scroller.scrollHeight;
    let lastActivityTime = Date.now();

    // Set up continuous MutationObserver to detect every incoming batch in real-time
    const obs = new MutationObserver(() => {
      const currCount = document.querySelectorAll('user-query').length;
      const currFirstSig = this.getFirstQueryText();

      // Only genuine query changes count as activity (prevents virtual scroll re-render from resetting timer)
      if (currCount > prevCount || (currFirstSig && currFirstSig !== prevFirstSig)) {
        lastActivityTime = Date.now(); // Reset activity timer because new prompts arrived!
        prevCount = currCount;
        prevFirstSig = currFirstSig;
        this.updateCatalog();
        if (syncBtn) {
          syncBtn.setAttribute('title', `正在同步... (已加载 ${currCount} 条，点击可停止)`);
        }
      }
    });

    obs.observe(scroller, { childList: true, subtree: true });

    // Continuous scroll pulsing loop
    // Keeps the icon spinning while loading, giving ample retry buffer (4.0s) for server RPCs across all batches
    const maxDurationMs = 120000; // 2 minutes safety ceiling
    const startTime = Date.now();
    const INACTIVITY_TIMEOUT_MS = 4000;

    try {
      while (!this.abortSync && (Date.now() - startTime < maxDurationMs)) {
        // Continuously nudge scroll to 0 to maintain top-boundary trigger on Gemini's infinite-scroller
        if (scroller.scrollTop > 0) {
          scroller.scrollTop = 0;
        } else {
          // Micro-nudge if already at 0 to re-trigger scroll listeners
          scroller.scrollTop = 25;
          scroller.scrollTop = 0;
        }
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));

        // Detect if content height expanded (signals newly prepended historical content)
        if (scroller.scrollHeight > prevScrollHeight + 10) {
          prevScrollHeight = scroller.scrollHeight;
          lastActivityTime = Date.now();
        }

        // Check if waiting for older batches
        const elapsedSinceActivity = Date.now() - lastActivityTime;
        if (elapsedSinceActivity > 1500 && syncBtn) {
          syncBtn.setAttribute('title', `正在同步... (已加载 ${prevCount} 条，正在检查更早的历史...)`);
        }

        // Check if no new prompts or height changes have occurred for 4.0 seconds
        if (elapsedSinceActivity > INACTIVITY_TIMEOUT_MS) {
          // Reached the true top of conversation history!
          break;
        }

        // Pulse every 250ms
        await new Promise(r => setTimeout(r, 250));
      }
    } finally {
      obs.disconnect();
      this.isSyncing = false;
      this.abortSync = false;
    }

    // Extract the pristine full list directly from the live DOM in top-to-bottom order
    const fullDomItems = this.extractFromDOM();
    if (chatId && fullDomItems && fullDomItems.length > 0) {
      this.cachedChatData = { items: fullDomItems, isFullySynced: true, updatedAt: Date.now() };
      this.saveChatCache(chatId, fullDomItems, true);
    }
    this.updateCatalog();

    if (syncBtn) {
      syncBtn.classList.remove('is-syncing');
      syncBtn.classList.add('is-synced');
      syncBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        <span>同步完成</span>
      `;
      syncBtn.setAttribute('title', `已完整同步全部 ${prevCount} 条历史提问`);

      setTimeout(() => {
        syncBtn.classList.remove('is-synced');
        syncBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        `;
        syncBtn.setAttribute('title', 'Refresh & sync full history');
      }, 1800);
    }
  },

  tryInjectUI: function () {
    // Find the native flex main container
    const mainContainer = document.querySelector('bard-sidenav-container');

    if (mainContainer) {
      this.createUI(mainContainer);
      this.createToggleButton();
      this.observeDOM();

      const chatId = this.getChatId();
      if (chatId) {
        this.loadChatCache(chatId, (cached) => {
          if (cached && cached.items && cached.items.length > 0) {
            this.cachedChatData = cached;
            this.updateCatalog();
          }
        });
      }
      setTimeout(() => this.updateCatalog(), 1000);
    } else {
      this.initAttempts++;
      if (this.initAttempts < 20) {
        setTimeout(() => this.tryInjectUI(), 500);
      } else {
        console.warn("GemiBoost: Could not find <bard-sidenav-container>. TOC injection failed.");
      }
    }
  },

  createUI: function (mainContainer) {
    if (document.getElementById(this.containerId)) return;

    const container = document.createElement('div');
    container.id = this.containerId;

    // Create a fixed-width inner wrapper to prevent text squeezing during width animation
    const innerWrapper = document.createElement('div');
    innerWrapper.id = 'gemiboost-toc-inner';

    const header = document.createElement('div');
    header.className = 'gemiboost-toc-header';
    header.innerHTML = `
      <div class="gemiboost-toc-title">Table of Contents</div>
      <div class="gemiboost-toc-header-actions">
        <button id="${this.syncBtnId}" class="gemiboost-toc-sync-btn" title="Refresh & sync full history" aria-label="Refresh & sync full history">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>
        <button class="gemiboost-toc-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>
        </button>
      </div>
    `;

    const closeBtn = header.querySelector('.gemiboost-toc-close');
    closeBtn.addEventListener('click', () => this.toggleCatalog(false));

    const syncBtn = header.querySelector(`#${this.syncBtnId}`);
    syncBtn.addEventListener('click', () => this.triggerHistorySync());

    const list = document.createElement('ul');
    list.id = 'gemiboost-toc-list';

    innerWrapper.appendChild(header);
    innerWrapper.appendChild(list);
    container.appendChild(innerWrapper);

    // Critical! Inject container as a flex sibling at the very end of bard-sidenav-container
    mainContainer.appendChild(container);
  },

  createToggleButton: function () {
    const isChatPage = location.pathname.startsWith('/app/') && location.pathname.length > 5;
    let toggleBtn = document.getElementById(this.toggleBtnId);

    if (!isChatPage) {
      if (toggleBtn) {
        toggleBtn.remove();
      }
      return;
    }

    // 1. Primary: Try to find the native three-dot menu button
    const buttons = document.querySelectorAll('button, [role="button"]');
    let kebabBtn = null;
    for (let btn of buttons) {
      const ariaLabel = btn.getAttribute('aria-label') || '';
      if (ariaLabel.includes("Open menu for conversation actions") ||
        btn.innerHTML.includes('more_vert')) {
        const rect = btn.getBoundingClientRect();
        if (rect.right > window.innerWidth / 2 && rect.top < 100) {
          kebabBtn = btn;
          break;
        }
      }
    }

    // 2. If kebab button is found, insert before it
    if (kebabBtn) {
      const targetIconWrapper = kebabBtn.closest('conversation-actions-icon') || kebabBtn.closest('gem-icon-button');
      if (targetIconWrapper && targetIconWrapper.parentElement) {
        if (!toggleBtn) toggleBtn = this.buildButtonElement();
        if (toggleBtn.parentElement !== targetIconWrapper.parentElement) {
          toggleBtn.classList.add('gemiboost-native-btn');
          targetIconWrapper.parentElement.insertBefore(toggleBtn, targetIconWrapper);
        }
        return;
      }
    }

    // 3. Secondary: If kebab button not found, insert into top toolbar container
    const topBarActions = document.querySelector('top-bar-actions .buttons-container') || document.querySelector('top-bar-actions');
    if (topBarActions) {
      if (!toggleBtn) toggleBtn = this.buildButtonElement();
      if (toggleBtn.parentElement !== topBarActions) {
        toggleBtn.classList.add('gemiboost-native-btn');
        topBarActions.insertBefore(toggleBtn, topBarActions.firstChild);
      }
      return;
    }
  },

  buildButtonElement: function () {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = this.toggleBtnId;
    toggleBtn.title = 'Toggle Table of Contents';
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
      </svg>
    `;
    toggleBtn.addEventListener('click', () => this.toggleCatalog(!this.isCatalogOpen));
    return toggleBtn;
  },

  toggleCatalog: function (show) {
    this.isCatalogOpen = show;
    const container = document.getElementById(this.containerId);
    if (container) {
      if (show) {
        container.classList.add('panel-visible');
        document.body.classList.add('gemiboost-toc-open');
        this.updateCatalog();
      } else {
        container.classList.remove('panel-visible');
        document.body.classList.remove('gemiboost-toc-open');
      }
    }
  },

  extractFromDOM: function () {
    const userPrompts = document.querySelectorAll('user-query');
    if (userPrompts.length === 0) return [];

    const extractedData = [];

    userPrompts.forEach((promptEl, index) => {
      // 1. Text extraction using textContent to prevent off-screen / content-visibility empty string
      const textNode = promptEl.querySelector('.query-text, p.query-text-line, .query-content') || promptEl;
      let text = textNode.textContent ? textNode.textContent.trim() : '';

      // Dynamically filter out hidden text intended for screen readers (e.g. "You said ")
      const hiddenLabel = promptEl.querySelector('.cdk-visually-hidden, [class*="visually-hidden"]');
      if (hiddenLabel && hiddenLabel.textContent) {
        const hiddenText = hiddenLabel.textContent.trim();
        if (text.startsWith(hiddenText)) {
          text = text.substring(hiddenText.length).trim();
        }
      }

      const rawText = text;
      const fileTexts = new Set();

      // 2. Extract independent images (filter out user-icon avatar and system profile icons)
      const images = Array.from(promptEl.querySelectorAll('img')).filter(img => {
        if (img.classList.contains('user-icon') || (img.src && img.src.includes('googleusercontent.com/a/'))) {
          return false;
        }
        const parentFile = img.closest('.file-preview-container, [class*="file-preview"]');
        if (parentFile && parentFile.textContent && parentFile.textContent.trim()) {
          return false;
        }
        return true;
      });

      images.forEach((img, imgIndex) => {
        if (fileTexts.has(img.src)) return;
        fileTexts.add(img.src);

        extractedData.push({
          type: 'image',
          display: '[Image]',
          className: 'gemiboost-toc-item gemiboost-toc-attachment',
          queryIndex: index,
          subIndex: imgIndex,
          rawText: rawText
        });
      });

      // 3. Extract independent files
      const files = Array.from(promptEl.querySelectorAll('.file-preview-container, [class*="file-preview"]'));
      files.forEach((file, fileIndex) => {
        const fileText = file.textContent ? file.textContent.trim() : '';
        if (!fileText) return;

        if (fileTexts.has(fileText)) return;
        fileTexts.add(fileText);

        if (text.includes(fileText)) {
          text = text.replace(fileText, '').trim();
        }

        const lines = fileText.split('\n').map(l => l.trim()).filter(l => l);
        const fName = lines.length > 1 ? lines[lines.length - 1] : lines[0];

        let fileType = 'File';
        let fullFileName = fName;
        const btn = file.querySelector('button[aria-label]');
        if (btn && btn.getAttribute('aria-label')) {
          fullFileName = btn.getAttribute('aria-label');
        }

        const extMatch = fullFileName.match(/\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
          fileType = extMatch[1].toUpperCase();
        } else {
          const iconImg = file.querySelector('img[alt*="icon" i]');
          if (iconImg && iconImg.alt) {
            const altType = iconImg.alt.replace(/icon/i, '').trim().toUpperCase();
            if (altType.length > 0 && altType.length <= 5) {
              fileType = altType;
            }
          } else if (lines.length > 1) {
            const possibleType = lines[0].toUpperCase();
            if (possibleType.length > 0 && possibleType.length <= 5) {
              fileType = possibleType;
            }
          }
        }

        extractedData.push({
          type: 'file',
          display: `[${fileType}] ` + (fName.length > 30 ? fName.substring(0, 30) + '...' : fName),
          className: 'gemiboost-toc-item gemiboost-toc-attachment',
          queryIndex: index,
          subIndex: fileIndex,
          rawText: rawText
        });
      });

      // 4. Extract remaining pure text
      if (text) {
        const textPreview = text.length > 40 ? text.substring(0, 40) + '...' : text;
        extractedData.push({
          type: 'text',
          display: textPreview,
          title: text,
          className: 'gemiboost-toc-item',
          queryIndex: index,
          rawText: rawText
        });
      }

      // 5. Extreme fallback: nothing was extracted
      if (!text && images.length === 0 && files.length === 0) {
        extractedData.push({
          type: 'empty',
          display: '[Empty]',
          className: 'gemiboost-toc-item',
          queryIndex: index,
          rawText: ''
        });
      }
    });

    return extractedData;
  },

  mergeWithCache: function (domItems, cachedItems) {
    if (!cachedItems || cachedItems.length === 0) return domItems;
    if (!domItems || domItems.length === 0) return cachedItems;

    const isMatch = (a, b) =>
      a.type === b.type &&
      a.rawText === b.rawText &&
      (a.subIndex === b.subIndex || (a.subIndex === undefined && b.subIndex === undefined));

    // Validate relative order of cachedItems against domItems
    // domItems reflects the ground-truth top-to-bottom order from the DOM
    let lastFoundIndex = -1;
    let isCorrupted = false;

    for (const d of domItems) {
      const idx = cachedItems.findIndex(c => isMatch(c, d));
      if (idx !== -1) {
        if (idx < lastFoundIndex) {
          isCorrupted = true;
          break;
        }
        lastFoundIndex = idx;
      }
    }

    if (isCorrupted) {
      console.warn('[GemiBoost] Detected out-of-order cached items. Clearing cache to restore correct DOM order.');
      const chatId = this.getChatId();
      if (chatId) this.clearChatCache(chatId);
      this.cachedChatData = null;
      return domItems;
    }

    // Only use cached items if the cache is marked as fully synced
    if (this.cachedChatData && this.cachedChatData.isFullySynced) {
      // Find earliest and latest matching indexes in domItems against cachedItems
      let firstDomMatch = -1;
      let lastDomMatch = -1;

      for (let i = 0; i < domItems.length; i++) {
        const d = domItems[i];
        const inCache = cachedItems.some(c => isMatch(c, d));
        if (inCache) {
          if (firstDomMatch === -1) firstDomMatch = i;
          lastDomMatch = i;
        }
      }

      let updated = [...cachedItems];
      let hasChanges = false;

      // 1. Prepend historical items loaded at the top (e.g. [File] Complete 基金 and earliest prompts)
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

      // Fallback: If user typed a new message when no items matched
      if (firstDomMatch === -1 && domItems.length > 0) {
        const lastDom = domItems[domItems.length - 1];
        if (!cachedItems.some(c => isMatch(c, lastDom))) {
          updated = [...cachedItems, lastDom];
          hasChanges = true;
        }
      }

      if (hasChanges) {
        this.cachedChatData.items = updated;
        const chatId = this.getChatId();
        if (chatId) this.saveChatCache(chatId, updated, true);
      }

      const domSet = new Set(domItems.map(d => `${d.type}:${d.rawText}:${d.subIndex ?? ''}`));
      return updated.map(c => ({
        ...c,
        isOffDOM: !domSet.has(`${c.type}:${c.rawText}:${c.subIndex ?? ''}`)
      }));
    }

    // If cache is not fully synced, DOM is the authoritative source
    return domItems;
  },

  navigateToItem: function (item) {
    if (this.isSyncing) {
      // During sync, ignore catalog clicks to ensure history loads completely to the top without interruption
      return;
    }

    let targetQuery = null;
    if (!item.isOffDOM && typeof item.queryIndex === 'number') {
      const queries = document.querySelectorAll('user-query');
      if (item.queryIndex < queries.length) {
        targetQuery = queries[item.queryIndex];
      }
    }

    // Verify targetQuery matches item text
    if (targetQuery && item.rawText) {
      const qText = (targetQuery.querySelector('.query-text, p.query-text-line, .query-content') || targetQuery).textContent.trim();
      if (!qText.includes(item.rawText.slice(0, 15))) {
        targetQuery = null;
      }
    }

    // Fallback: search all current DOM queries
    if (!targetQuery && item.rawText) {
      const queries = Array.from(document.querySelectorAll('user-query'));
      targetQuery = queries.find(q => {
        const textNode = q.querySelector('.query-text, p.query-text-line, .query-content') || q;
        return textNode.textContent.trim().includes(item.rawText.slice(0, 20));
      });
    }

    if (targetQuery) {
      // Element is present in DOM: smooth scroll straight to it
      this.scrollToTargetElement(targetQuery, item);
      return;
    }

    // Element is an earlier turn not yet rendered in DOM: trigger smooth upward scroll to mount it
    const scroller = this.getChatScrollContainer();
    if (!scroller) return;

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const queries = Array.from(document.querySelectorAll('user-query'));
      const found = queries.find(q => {
        const textNode = q.querySelector('.query-text, p.query-text-line, .query-content') || q;
        return item.rawText ? textNode.textContent.trim().includes(item.rawText.slice(0, 20)) : false;
      });

      if (found) {
        clearInterval(interval);
        this.scrollToTargetElement(found, item);
        this.updateCatalog();
      } else if (attempts >= 10) {
        clearInterval(interval);
        scroller.scrollTop = 0;
      }
    }, 200);
  },

  scrollToTargetElement: function (targetQuery, item) {
    if (item.type === 'image') {
      const validImgs = Array.from(targetQuery.querySelectorAll('img')).filter(img => {
        if (img.classList.contains('user-icon') || (img.src && img.src.includes('googleusercontent.com/a/'))) {
          return false;
        }
        const parentFile = img.closest('.file-preview-container, [class*="file-preview"]');
        if (parentFile && parentFile.textContent && parentFile.textContent.trim()) {
          return false;
        }
        return true;
      });
      const targetImg = validImgs[item.subIndex];
      if (targetImg) targetImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else targetQuery.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (item.type === 'file') {
      const files = targetQuery.querySelectorAll('.file-preview-container, [class*="file-preview"]');
      const targetFile = files[item.subIndex];
      if (targetFile) targetFile.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else targetQuery.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      targetQuery.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  updateCatalog: function () {
    const list = document.getElementById('gemiboost-toc-list');
    if (!list) return;

    const domItems = this.extractFromDOM();
    const cachedItems = this.cachedChatData?.items || [];
    const finalItems = this.mergeWithCache(domItems, cachedItems);

    if (finalItems.length === 0) {
      if (this.lastQueryCount === 0 && this.lastSignature === 'empty') return;
      this.lastQueryCount = 0;
      this.lastSignature = 'empty';
      list.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'gemiboost-toc-empty';
      li.innerText = 'No conversation yet.';
      list.appendChild(li);
      return;
    }

    const signature = finalItems.map(it => `${it.queryIndex}:${it.type}:${it.display}`).join('|');
    if (signature === this.lastSignature && finalItems.length === this.lastQueryCount) {
      return;
    }

    this.lastSignature = signature;
    this.lastQueryCount = finalItems.length;
    this.lastExtractedData = finalItems;

    // Persist cache updates only if this chat was already fully synced (e.g. appending new user turns)
    const chatId = this.getChatId();
    if (chatId && this.cachedChatData?.isFullySynced && !this.isSyncing) {
      this.saveChatCache(chatId, finalItems, true);
    }

    const currentScrollTop = list.scrollTop;
    list.innerHTML = '';

    finalItems.forEach((item) => {
      const li = document.createElement('li');
      li.className = item.className;
      li.innerText = item.display;
      if (item.title) li.title = item.title;

      li.addEventListener('click', () => {
        this.navigateToItem(item);
      });

      list.appendChild(li);
    });

    list.scrollTop = currentScrollTop;
  },

  observeDOM: function () {
    const debouncedUpdate = Utils.debounce(() => {
      this.updateCatalog();
      this.createToggleButton();
    }, 1000);

    const observer = new MutationObserver((mutations) => {
      if (this.currentUrl !== location.href) {
        this.currentUrl = location.href;
        this.lastSignature = '';
        this.lastQueryCount = 0;
        this.cachedChatData = null;

        if (this.isCatalogOpen) {
          const container = document.getElementById(this.containerId);
          if (container) {
            container.style.transition = 'none';
            this.toggleCatalog(false);
            void container.offsetHeight;
            container.style.transition = '';
          } else {
            this.toggleCatalog(false);
          }
        }

        const btn = document.getElementById(this.toggleBtnId);
        if (btn) btn.remove();

        const newChatId = this.getChatId();
        if (newChatId) {
          this.loadChatCache(newChatId, (cached) => {
            if (cached && cached.items && cached.items.length > 0) {
              this.cachedChatData = cached;
              this.updateCatalog();
            }
          });
        }
      }

      if (!document.getElementById(this.containerId)) {
        const mainContainer = document.querySelector('bard-sidenav-container');
        if (mainContainer) {
          this.createUI(mainContainer);
          this.lastSignature = '';
          this.lastQueryCount = 0;
          this.updateCatalog();

          if (this.isCatalogOpen) {
            const container = document.getElementById(this.containerId);
            container.style.transition = 'none';
            container.classList.add('panel-visible');
            void container.offsetHeight;
            container.style.transition = '';
          }
        }
      }

      let shouldUpdate = false;
      for (let mutation of mutations) {
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          shouldUpdate = true;
          break;
        }
      }
      if (shouldUpdate) {
        debouncedUpdate();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }
};
