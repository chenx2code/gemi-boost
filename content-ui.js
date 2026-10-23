// content-ui.js
// Handles UI creation, toolbar button mounting, TOC rendering, and navigation

window.GemiBoost = window.GemiBoost || {};

GemiBoost.UI = {
  // Ensure the main TOC sidebar drawer is injected into bard-sidenav-container
  ensureDrawerUI: function (callbacks = {}) {
    const { onClose, onSync, onExport } = callbacks;
    const containerId = GemiBoost.Config.DOM_IDS.CONTAINER;
    let container = document.getElementById(containerId);
    if (container) return container;

    const mainContainer = document.querySelector(GemiBoost.Config.SELECTORS.MAIN_CONTAINER);
    if (!mainContainer) return null;

    container = document.createElement('div');
    container.id = containerId;

    const innerWrapper = document.createElement('div');
    innerWrapper.id = GemiBoost.Config.DOM_IDS.INNER;

    const header = document.createElement('div');
    header.className = 'gemiboost-toc-header';
    header.innerHTML = `
      <div class="gemiboost-toc-title">Table of Contents</div>
      <div class="gemiboost-toc-header-actions">
        <button id="${GemiBoost.Config.DOM_IDS.EXPORT_BTN}" class="gemiboost-toc-export-btn" title="Export conversation to Markdown (.md)" aria-label="Export conversation to Markdown (.md)" data-state="idle">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </button>
        <button id="${GemiBoost.Config.DOM_IDS.SYNC_BTN}" class="gemiboost-toc-sync-btn" title="Refresh & sync full history" aria-label="Refresh & sync full history" data-state="idle">
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
    closeBtn.addEventListener('click', () => {
      if (onClose) onClose();
    });

    const syncBtn = header.querySelector(`#${GemiBoost.Config.DOM_IDS.SYNC_BTN}`);
    syncBtn.addEventListener('click', () => {
      if (onSync) onSync();
    });

    const exportBtn = header.querySelector(`#${GemiBoost.Config.DOM_IDS.EXPORT_BTN}`);
    exportBtn.addEventListener('click', () => {
      if (onExport) onExport();
    });

    const list = document.createElement('ul');
    list.id = GemiBoost.Config.DOM_IDS.LIST;

    innerWrapper.appendChild(header);
    innerWrapper.appendChild(list);
    container.appendChild(innerWrapper);

    mainContainer.appendChild(container);
    return container;
  },

  // Mount the toggle button into Gemini's top action toolbar
  mountToggleButton: function (callbacks = {}) {
    const { onClick } = callbacks;
    const isChatPage = GemiBoost.Utils.isChatPage();
    const toggleBtnId = GemiBoost.Config.DOM_IDS.TOGGLE_BTN;
    let toggleBtn = document.getElementById(toggleBtnId);

    if (!isChatPage) {
      if (toggleBtn) toggleBtn.remove();
      return null;
    }

    // Check if an existing button was attached to an invalid or off-screen container
    if (toggleBtn) {
      const isMisplaced =
        toggleBtn.parentElement === document.body ||
        toggleBtn.closest(GemiBoost.Config.SELECTORS.CHAT_SCROLLER_EXCLUDE);
      const bRect = toggleBtn.getBoundingClientRect();
      if (isMisplaced || bRect.top < 0 || bRect.top > 100) {
        toggleBtn.remove();
        toggleBtn = null;
      }
    }

    // 1. Primary: Search for conversation actions button within top bar containers
    let topBar = null;
    for (const selector of GemiBoost.Config.SELECTORS.TOP_BAR_CONTAINERS) {
      topBar = document.querySelector(selector);
      if (topBar) break;
    }

    let kebabBtn = null;
    if (topBar) {
      const topBarButtons = topBar.querySelectorAll('button, [role="button"]');
      for (let btn of topBarButtons) {
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel.includes('conversation') || ariaLabel.includes('actions') || btn.innerHTML.includes('more_vert')) {
          const rect = btn.getBoundingClientRect();
          if (rect.top >= 0 && rect.top <= 80) {
            kebabBtn = btn;
            break;
          }
        }
      }
    }

    // 2. Secondary fallback: Search globally, but strictly exclude message & chat scroll content
    if (!kebabBtn) {
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (let btn of buttons) {
        if (btn.closest(GemiBoost.Config.SELECTORS.CHAT_SCROLLER_EXCLUDE)) {
          continue;
        }

        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        const isActionBtn =
          ariaLabel.includes('open menu for conversation actions') ||
          (ariaLabel.includes('conversation') && ariaLabel.includes('actions')) ||
          btn.innerHTML.includes('more_vert');

        if (isActionBtn) {
          const rect = btn.getBoundingClientRect();
          if (rect.top >= 0 && rect.top <= 80 && rect.right > window.innerWidth / 2) {
            kebabBtn = btn;
            break;
          }
        }
      }
    }

    // 3. If kebab button is found, insert before it
    if (kebabBtn) {
      const targetIconWrapper =
        kebabBtn.closest('conversation-actions-icon') ||
        kebabBtn.closest('gem-icon-button') ||
        kebabBtn;

      if (targetIconWrapper && targetIconWrapper.parentElement) {
        if (!targetIconWrapper.closest(GemiBoost.Config.SELECTORS.CHAT_SCROLLER_EXCLUDE)) {
          if (!toggleBtn) toggleBtn = this.buildButtonElement(onClick);
          if (toggleBtn.parentElement !== targetIconWrapper.parentElement) {
            toggleBtn.classList.add('gemiboost-native-btn');
            targetIconWrapper.parentElement.insertBefore(toggleBtn, targetIconWrapper);
          }
          return toggleBtn;
        }
      }
    }

    // 4. If kebab button not found, insert into top toolbar container
    for (const selector of GemiBoost.Config.SELECTORS.TOP_BAR_ACTIONS) {
      const topBarActions = document.querySelector(selector);
      if (topBarActions && topBarActions.querySelectorAll('button, [role="button"]').length > 0) {
        if (!toggleBtn) toggleBtn = this.buildButtonElement(onClick);
        if (toggleBtn.parentElement !== topBarActions) {
          toggleBtn.classList.add('gemiboost-native-btn');
          topBarActions.insertBefore(toggleBtn, topBarActions.firstChild);
        }
        return toggleBtn;
      }
    }

    return null;
  },

  // Build the toggle button element
  buildButtonElement: function (onClick) {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = GemiBoost.Config.DOM_IDS.TOGGLE_BTN;
    toggleBtn.classList.add('gemiboost-native-btn');
    toggleBtn.title = 'Toggle Table of Contents';
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
      </svg>
    `;
    toggleBtn.addEventListener('click', () => {
      if (onClick) onClick();
    });
    return toggleBtn;
  },

  // Toggle drawer open/close visibility
  setDrawerVisible: function (show) {
    const container = document.getElementById(GemiBoost.Config.DOM_IDS.CONTAINER);
    if (container) {
      if (show) {
        container.classList.add('panel-visible');
        document.body.classList.add('gemiboost-toc-open');
      } else {
        container.classList.remove('panel-visible');
        document.body.classList.remove('gemiboost-toc-open');
      }
    } else {
      if (!show) {
        document.body.classList.remove('gemiboost-toc-open');
      }
    }
  },

  // Update sync button icon and state without disrupting ongoing CSS animations
  setSyncButtonState: function (state, tooltip) {
    const syncBtn = document.getElementById(GemiBoost.Config.DOM_IDS.SYNC_BTN);
    if (!syncBtn) return;

    const prevState = syncBtn.dataset.state || (
      syncBtn.classList.contains('is-syncing') ? 'syncing' :
      syncBtn.classList.contains('is-synced') ? 'synced' : 'idle'
    );
    const isStateChanged = prevState !== state;

    if (isStateChanged) {
      syncBtn.dataset.state = state;
      if (state === 'syncing') {
        syncBtn.classList.remove('is-synced');
        syncBtn.classList.add('is-syncing');
        syncBtn.innerHTML = `
          <span class="gemiboost-spinner-composited">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </span>
        `;
      } else if (state === 'synced') {
        syncBtn.classList.remove('is-syncing');
        syncBtn.classList.add('is-synced');
        syncBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        `;
      } else {
        syncBtn.classList.remove('is-syncing', 'is-synced');
        syncBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        `;
      }
    }

    const defaultTooltip = state === 'syncing'
      ? '正在加载全部历史记录... (再次点击可取消)'
      : state === 'synced'
      ? '已完整同步全部历史记录'
      : 'Refresh & sync full history';

    const finalTooltip = tooltip || defaultTooltip;
    syncBtn.setAttribute('title', finalTooltip);
    syncBtn.setAttribute('aria-label', finalTooltip);
  },

  // Update export button state in top header
  setExportButtonState: function (state, tooltip) {
    const exportBtn = document.getElementById(GemiBoost.Config.DOM_IDS.EXPORT_BTN);
    if (!exportBtn) return;

    const defaultTooltip =
      state === 'syncing'
        ? '正在同步历史记录以供导出...'
        : state === 'exporting'
        ? '正在导出 Markdown 文件...'
        : state === 'success'
        ? '导出成功！'
        : 'Export conversation to Markdown (.md)';

    const finalTooltip = tooltip || defaultTooltip;
    exportBtn.dataset.state = state;

    if (state === 'syncing' || state === 'exporting') {
      exportBtn.classList.remove('is-success');
      exportBtn.classList.add('is-loading');
      exportBtn.innerHTML = `
        <span class="gemiboost-spinner-composited">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" stroke-dasharray="40 18" />
          </svg>
        </span>
      `;
    } else if (state === 'success') {
      exportBtn.classList.remove('is-loading');
      exportBtn.classList.add('is-success');
      exportBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
      `;
    } else {
      exportBtn.classList.remove('is-loading', 'is-success');
      exportBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
      `;
    }

    exportBtn.setAttribute('title', finalTooltip);
    exportBtn.setAttribute('aria-label', finalTooltip);
  },

  // Render list of items into TOC list container
  renderList: function (items, onItemClick) {
    const list = document.getElementById(GemiBoost.Config.DOM_IDS.LIST);
    if (!list) return;

    if (!items || items.length === 0) {
      list.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'gemiboost-toc-empty';
      li.innerText = 'No conversation yet.';
      list.appendChild(li);
      return;
    }

    const currentScrollTop = list.scrollTop;
    list.innerHTML = '';

    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = item.className;
      li.innerText = item.display;
      if (item.title) li.title = item.title;

      li.addEventListener('click', () => {
        if (onItemClick) onItemClick(item);
      });

      list.appendChild(li);
    });

    list.scrollTop = currentScrollTop;
  },

  // Navigate and scroll to a specific prompt or attachment
  navigateToItem: function (item, onUpdateCatalog) {
    if (GemiBoost.Sync && GemiBoost.Sync.isCurrentlySyncing()) {
      return;
    }

    let targetQuery = null;
    if (!item.isOffDOM && typeof item.queryIndex === 'number') {
      const queries = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY);
      if (item.queryIndex < queries.length) {
        targetQuery = queries[item.queryIndex];
      }
    }

    // Verify targetQuery matches item text
    if (targetQuery && item.rawText) {
      const qText = (
        targetQuery.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || targetQuery
      ).textContent.trim();
      if (!qText.includes(item.rawText.slice(0, 15))) {
        targetQuery = null;
      }
    }

    // Fallback: search all current DOM queries
    if (!targetQuery && item.rawText) {
      const queries = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
      targetQuery = queries.find((q) => {
        const textNode = q.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || q;
        return textNode.textContent.trim().includes(item.rawText.slice(0, 20));
      });
    }

    if (targetQuery) {
      this.scrollToTargetElement(targetQuery, item);
      return;
    }

    // If turn is not currently rendered in virtual scroller, scroll up to trigger loading
    const scroller = GemiBoost.Utils.getChatScrollContainer();
    if (!scroller) return;

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

    let attempts = 0;
    const maxAttempts = GemiBoost.Config.TIMING.NAVIGATE_SCROLL_MAX_ATTEMPTS;
    const retryInterval = GemiBoost.Config.TIMING.NAVIGATE_SCROLL_RETRY_MS;

    const interval = setInterval(() => {
      attempts++;
      const queries = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
      const found = queries.find((q) => {
        const textNode = q.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || q;
        return item.rawText ? textNode.textContent.trim().includes(item.rawText.slice(0, 20)) : false;
      });

      if (found) {
        clearInterval(interval);
        this.scrollToTargetElement(found, item);
        if (onUpdateCatalog) onUpdateCatalog();
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        scroller.scrollTop = 0;
      }
    }, retryInterval);
  },

  // Scroll to a specific sub-element (image/file) or user query block
  scrollToTargetElement: function (targetQuery, item) {
    if (item.type === 'image') {
      const validImgs = Array.from(targetQuery.querySelectorAll('img')).filter((img) => {
        if (img.classList.contains('user-icon') || (img.src && img.src.includes('googleusercontent.com/a/'))) {
          return false;
        }
        const parentFile = img.closest(GemiBoost.Config.SELECTORS.FILE_CONTAINER);
        if (parentFile && parentFile.textContent && parentFile.textContent.trim()) {
          return false;
        }
        return true;
      });
      const targetImg = validImgs[item.subIndex];
      if (targetImg) targetImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else targetQuery.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (item.type === 'file') {
      const files = targetQuery.querySelectorAll(GemiBoost.Config.SELECTORS.FILE_CONTAINER);
      const targetFile = files[item.subIndex];
      if (targetFile) targetFile.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else targetQuery.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      targetQuery.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
};
