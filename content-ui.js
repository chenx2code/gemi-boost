// content-ui.js
// Handles UI creation, toolbar button mounting, TOC rendering, navigation, and M3 styling

window.GemiBoost = window.GemiBoost || {};

// UI localization strings
const I18N_UI = {
  zh: {
    title: '目录',
    badgeText: (count) => `${count} 轮`,
    emptyTitle: '暂无对话内容',
    emptyDesc: '发送消息后，目录将自动生成',
    syncIdle: '刷新并同步完整记录',
    syncLoading: '正在加载全部历史记录... (再次点击可取消)',
    syncSuccess: '已完整同步全部历史记录',
    exportIdle: '导出对话为 Markdown (.md)',
    exportSyncing: '正在同步历史记录以供导出...',
    exportLoading: '正在导出 Markdown 文件...',
    exportSuccess: '导出成功！',
    closeTitle: '关闭目录',
    toggleTitle: '展开/收起目录',
    imageLabel: '图片',
    fileLabel: '文件'
  },
  en: {
    title: 'Table of Contents',
    badgeText: (count) => `${count}`,
    emptyTitle: 'No conversation yet',
    emptyDesc: 'Prompts will appear here automatically',
    syncIdle: 'Refresh & sync full history',
    syncLoading: 'Loading full history... (click to cancel)',
    syncSuccess: 'Full history synced',
    exportIdle: 'Export conversation to Markdown (.md)',
    exportSyncing: 'Syncing history for export...',
    exportLoading: 'Exporting Markdown file...',
    exportSuccess: 'Export complete!',
    closeTitle: 'Close Table of Contents',
    toggleTitle: 'Toggle Table of Contents',
    imageLabel: 'Image',
    fileLabel: 'File'
  }
};

GemiBoost.UI = {
  _scrollSpyBound: false,

  // Get current active language strings
  getStrings: function () {
    const isChinese = (navigator.language && navigator.language.startsWith('zh')) ||
      (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage().startsWith('zh'));
    return isChinese ? I18N_UI.zh : I18N_UI.en;
  },

  // Ensure the main TOC sidebar drawer is injected into bard-sidenav-container
  ensureDrawerUI: function (callbacks = {}) {
    const { onClose, onSync, onExport } = callbacks;
    const containerId = GemiBoost.Config.DOM_IDS.CONTAINER;
    let container = document.getElementById(containerId);
    if (container) return container;

    const mainContainer = document.querySelector(GemiBoost.Config.SELECTORS.MAIN_CONTAINER);
    if (!mainContainer) return null;

    const strings = this.getStrings();

    container = document.createElement('div');
    container.id = containerId;

    const innerWrapper = document.createElement('div');
    innerWrapper.id = GemiBoost.Config.DOM_IDS.INNER;

    const header = document.createElement('div');
    header.className = 'gemiboost-toc-header';
    header.innerHTML = `
      <div class="gemiboost-toc-title-group">
        <span class="gemiboost-toc-title">${strings.title}</span>
        <span id="gemiboost-toc-badge" class="gemiboost-toc-badge is-hidden">0</span>
      </div>
      <div class="gemiboost-toc-header-actions">
        <button id="${GemiBoost.Config.DOM_IDS.EXPORT_BTN}" class="gemiboost-toc-export-btn" title="${strings.exportIdle}" aria-label="${strings.exportIdle}" data-state="idle">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </button>
        <button id="${GemiBoost.Config.DOM_IDS.SYNC_BTN}" class="gemiboost-toc-sync-btn" title="${strings.syncIdle}" aria-label="${strings.syncIdle}" data-state="idle">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>
        <button class="gemiboost-toc-close" title="${strings.closeTitle}" aria-label="${strings.closeTitle}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
          </svg>
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
    const strings = this.getStrings();
    const toggleBtn = document.createElement('button');
    toggleBtn.id = GemiBoost.Config.DOM_IDS.TOGGLE_BTN;
    toggleBtn.classList.add('gemiboost-native-btn');
    toggleBtn.title = strings.toggleTitle;
    toggleBtn.setAttribute('aria-label', strings.toggleTitle);
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
        this.setupScrollSpy();
        this.updateActiveItem();
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

  // Setup lightweight scroll spy for tracking active turn in chat
  setupScrollSpy: function () {
    if (this._scrollSpyBound) return;
    const scroller = GemiBoost.Utils.getChatScrollContainer();
    if (!scroller) return;

    this._scrollSpyBound = true;
    const onScroll = GemiBoost.Utils.debounce(() => {
      this.updateActiveItem();
    }, 100);

    scroller.addEventListener('scroll', onScroll, { passive: true });
  },

  // Highlight TOC item corresponding to current viewport position
  updateActiveItem: function () {
    const scroller = GemiBoost.Utils.getChatScrollContainer();
    if (!scroller) return;
    const queries = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
    if (queries.length === 0) return;

    const scrollerRect = scroller.getBoundingClientRect();
    let activeIndex = -1;

    for (let i = 0; i < queries.length; i++) {
      const rect = queries[i].getBoundingClientRect();
      if (rect.top <= scrollerRect.top + 250) {
        activeIndex = i;
      } else {
        break;
      }
    }

    if (activeIndex === -1 && queries.length > 0) activeIndex = 0;

    const list = document.getElementById(GemiBoost.Config.DOM_IDS.LIST);
    if (!list) return;

    const items = list.querySelectorAll('.gemiboost-toc-item');
    items.forEach((li) => {
      const qIdx = parseInt(li.dataset.queryIndex, 10);
      if (qIdx === activeIndex) {
        li.classList.add('is-active');
      } else {
        li.classList.remove('is-active');
      }
    });
  },

  // Update sync button icon and state without disrupting ongoing CSS animations
  setSyncButtonState: function (state, tooltip) {
    const syncBtn = document.getElementById(GemiBoost.Config.DOM_IDS.SYNC_BTN);
    if (!syncBtn) return;

    const strings = this.getStrings();
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
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </span>
        `;
      } else if (state === 'synced') {
        syncBtn.classList.remove('is-syncing');
        syncBtn.classList.add('is-synced');
        syncBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        `;
      } else {
        syncBtn.classList.remove('is-syncing', 'is-synced');
        syncBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        `;
      }
    }

    const defaultTooltip = state === 'syncing'
      ? strings.syncLoading
      : state === 'synced'
      ? strings.syncSuccess
      : strings.syncIdle;

    const finalTooltip = tooltip || defaultTooltip;
    syncBtn.setAttribute('title', finalTooltip);
    syncBtn.setAttribute('aria-label', finalTooltip);
  },

  // Update export button state in top header
  setExportButtonState: function (state, tooltip) {
    const exportBtn = document.getElementById(GemiBoost.Config.DOM_IDS.EXPORT_BTN);
    if (!exportBtn) return;

    const strings = this.getStrings();
    const defaultTooltip =
      state === 'syncing'
        ? strings.exportSyncing
        : state === 'exporting'
        ? strings.exportLoading
        : state === 'success'
        ? strings.exportSuccess
        : strings.exportIdle;

    const finalTooltip = tooltip || defaultTooltip;
    exportBtn.dataset.state = state;

    if (state === 'syncing' || state === 'exporting') {
      exportBtn.classList.remove('is-success');
      exportBtn.classList.add('is-loading');
      exportBtn.innerHTML = `
        <span class="gemiboost-spinner-composited">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" stroke-dasharray="40 18" />
          </svg>
        </span>
      `;
    } else if (state === 'success') {
      exportBtn.classList.remove('is-loading');
      exportBtn.classList.add('is-success');
      exportBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
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

    const strings = this.getStrings();
    const badge = document.getElementById('gemiboost-toc-badge');

    // Update header turn count badge
    if (badge) {
      if (items && items.length > 0) {
        const uniqueTurns = new Set(items.map((it) => it.queryIndex)).size;
        badge.textContent = strings.badgeText(uniqueTurns);
        badge.classList.remove('is-hidden');
      } else {
        badge.textContent = '0';
        badge.classList.add('is-hidden');
      }
    }

    // Empty State
    if (!items || items.length === 0) {
      list.innerHTML = `
        <li class="gemiboost-toc-empty">
          <div class="gemiboost-empty-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>
            </svg>
          </div>
          <div class="gemiboost-empty-title">${strings.emptyTitle}</div>
          <div class="gemiboost-empty-desc">${strings.emptyDesc}</div>
        </li>
      `;
      return;
    }

    const currentScrollTop = list.scrollTop;
    list.innerHTML = '';

    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = item.className || 'gemiboost-toc-item';
      li.dataset.queryIndex = item.queryIndex !== undefined ? String(item.queryIndex) : '';
      if (item.subIndex !== undefined) {
        li.dataset.subIndex = String(item.subIndex);
      }
      if (item.title) li.title = item.title;

      // 1. Leading Slot: Turn Sequence Badge OR Type Icon Badge (identical 22px width for uniform indentation)
      const leading = document.createElement('div');
      leading.className = 'gemiboost-item-leading';

      if (item.isTurnRoot) {
        const turnNum = typeof item.queryIndex === 'number' ? item.queryIndex + 1 : index + 1;
        const badgeStr = turnNum < 10 ? '0' + turnNum : String(turnNum);
        leading.innerHTML = `<span class="gemiboost-turn-badge">${badgeStr}</span>`;
      } else if (item.type === 'image') {
        leading.innerHTML = `
          <span class="gemiboost-type-icon gemiboost-icon-image" title="${strings.imageLabel}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
          </span>
        `;
      } else if (item.type === 'file') {
        leading.innerHTML = `
          <span class="gemiboost-type-icon gemiboost-icon-file" title="${strings.fileLabel}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
            </svg>
          </span>
        `;
      } else {
        leading.innerHTML = `<span class="gemiboost-turn-badge">--</span>`;
      }

      // 2. Text Content Area
      const content = document.createElement('div');
      content.className = 'gemiboost-item-content';

      const textSpan = document.createElement('span');
      textSpan.className = 'gemiboost-item-text';

      // If this item is a turn root AND is an attachment (i.e. pure attachment turn),
      // include a subtle inline icon inside the content area to indicate its media type
      if (item.isTurnRoot && item.type === 'image') {
        const imgIcon = document.createElement('span');
        imgIcon.className = 'gemiboost-inline-icon gemiboost-icon-image';
        imgIcon.title = strings.imageLabel;
        imgIcon.innerHTML = `
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
          </svg>
        `;
        textSpan.appendChild(imgIcon);
      } else if (item.isTurnRoot && item.type === 'file') {
        const fileIcon = document.createElement('span');
        fileIcon.className = 'gemiboost-inline-icon gemiboost-icon-file';
        fileIcon.title = strings.fileLabel;
        fileIcon.innerHTML = `
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
        `;
        textSpan.appendChild(fileIcon);
      }

      let displayContent = item.display || '';
      if (item.type === 'image' && (displayContent === '[Image]' || !displayContent)) {
        displayContent = strings.imageLabel;
      }
      textSpan.appendChild(document.createTextNode(displayContent));
      content.appendChild(textSpan);

      li.appendChild(leading);
      li.appendChild(content);

      li.addEventListener('click', () => {
        // Highlight active item
        const allItems = list.querySelectorAll('.gemiboost-toc-item');
        allItems.forEach((el) => el.classList.remove('is-active'));
        li.classList.add('is-active');

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

    // Verify targetQuery matches item text if text is present
    if (targetQuery && item.rawText) {
      const qText = (
        targetQuery.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || targetQuery
      ).textContent.trim();
      if (!qText.includes(item.rawText.slice(0, 15))) {
        targetQuery = null;
      }
    }

    // Fallback: search all current DOM queries
    if (!targetQuery) {
      const queries = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
      if (item.rawText) {
        targetQuery = queries.find((q) => {
          const textNode = q.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || q;
          return textNode.textContent.trim().includes(item.rawText.slice(0, 20));
        });
      } else if (typeof item.queryIndex === 'number' && item.queryIndex < queries.length) {
        targetQuery = queries[item.queryIndex];
      }
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
        if (item.rawText) {
          const textNode = q.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || q;
          return textNode.textContent.trim().includes(item.rawText.slice(0, 20));
        }
        if (item.type === 'image') {
          return q.querySelector('img:not(.user-icon)') !== null;
        }
        if (item.type === 'file') {
          return q.querySelector(GemiBoost.Config.SELECTORS.FILE_CONTAINER) !== null;
        }
        return false;
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
      const targetImg = validImgs[item.subIndex || 0];
      if (targetImg) targetImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else targetQuery.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (item.type === 'file') {
      const files = targetQuery.querySelectorAll(GemiBoost.Config.SELECTORS.FILE_CONTAINER);
      const targetFile = files[item.subIndex || 0];
      if (targetFile) targetFile.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else targetQuery.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      targetQuery.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
};
