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
    obsidianIdle: '一键导入至 Obsidian',
    obsidianSyncing: '正在同步历史记录以供导入...',
    obsidianLoading: '正在准备导入 Obsidian...',
    obsidianSuccess: '已导入至 Obsidian！',
    obsidianModalTitle: '导入至 Obsidian',
    obsidianModalFolderLabel: '目标文件夹',
    obsidianModalFolderPlaceholder: '例如: Gemini 或 Work/AI',
    obsidianModalTitleLabel: '笔记标题',
    obsidianModalRecentLabel: '快捷历史标签:',
    obsidianModalSetDefault: '设为默认文件夹且不再提醒',
    cancelBtn: '取消',
    confirmExportBtn: '确认导入',
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
    obsidianIdle: 'Export conversation to Obsidian',
    obsidianSyncing: 'Syncing history for Obsidian...',
    obsidianLoading: 'Importing to Obsidian...',
    obsidianSuccess: 'Imported to Obsidian!',
    obsidianModalTitle: 'Import to Obsidian',
    obsidianModalFolderLabel: 'Target Folder',
    obsidianModalFolderPlaceholder: 'e.g. Gemini or Work/AI',
    obsidianModalTitleLabel: 'Note Title',
    obsidianModalRecentLabel: 'Recent folders:',
    obsidianModalSetDefault: 'Set as default folder and do not ask again',
    cancelBtn: 'Cancel',
    confirmExportBtn: 'Export',
    closeTitle: 'Close Table of Contents',
    toggleTitle: 'Toggle Table of Contents',
    imageLabel: 'Image',
    fileLabel: 'File'
  }
};

GemiBoost.UI = {
  _items: [],
  _scrollSpyBound: false,
  _cancelAnimation: null,
  _isNavigating: false,

  // Get current active language strings
  getStrings: function () {
    let isChinese = false;
    try {
      if (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) {
        isChinese = document.documentElement.lang.toLowerCase().startsWith('zh');
      } else if (typeof navigator !== 'undefined' && navigator.language) {
        isChinese = navigator.language.toLowerCase().startsWith('zh');
      }
      if (!isChinese && typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.i18n?.getUILanguage) {
        isChinese = chrome.i18n.getUILanguage().toLowerCase().startsWith('zh');
      }
    } catch (e) {
      isChinese = (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('zh')) || false;
    }
    return isChinese ? I18N_UI.zh : I18N_UI.en;
  },

  // Ensure the main TOC sidebar drawer is injected into bard-sidenav-container
  ensureDrawerUI: function (callbacks = {}) {
    const { onClose, onSync, onExport, onObsidian } = callbacks;
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
        <button id="${GemiBoost.Config.DOM_IDS.OBSIDIAN_BTN}" class="gemiboost-toc-obsidian-btn" title="${strings.obsidianIdle}" aria-label="${strings.obsidianIdle}" data-state="idle">
          <svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="currentColor">
            <path d="M9.643 14.012c.615-.183 1.605-.465 2.745-.534-.684-1.725-.849-3.235-.716-4.579.153-1.552.7-2.847 1.234-3.95.114-.235.223-.454.328-.664.149-.297.289-.577.42-.86.217-.47.378-.885.46-1.27.08-.38.08-.719-.014-1.044-.095-.325-.297-.675-.681-1.06a1.6 1.6 0 00-1.475.36l-4.95 4.453a1.602 1.602 0 00-.512.952l-.427 2.83c.67.592 2.327 2.317 3.335 4.71.09.213.174.432.253.656zM5.855 9.937c-.024.1-.057.197-.099.29L3.14 16.058a1.602 1.602 0 00.313 1.772l4.117 4.24c2.102-3.102 1.795-6.02.835-8.3-.728-1.73-1.832-3.083-2.55-3.833z"/>
            <path d="M8.52 22.57c.073.01.146.018.22.02.781.023 2.095.091 3.16.288.87.16 2.593.642 4.011 1.056 1.082.316 2.197-.548 2.354-1.664.115-.814.33-1.735.725-2.58l-.009.004c-.67-1.87-1.523-3.077-2.417-3.847a5.294 5.294 0 00-2.777-1.258c-1.541-.216-2.952.189-3.841.45.532 2.218.368 4.828-1.425 7.53z"/>
            <path d="M19.676 18.538a69.072 69.072 0 001.858-2.952.811.811 0 00-.061-.901c-.516-.684-1.504-2.075-2.042-3.362-.554-1.323-.636-3.378-.64-4.378a1.708 1.708 0 00-.359-1.051L15.235 1.83a3.757 3.757 0 01-.076.545c-.107.503-.307 1.004-.536 1.498-.135.29-.29.601-.446.915-.105.21-.21.42-.31.626-.517 1.068-.998 2.227-1.132 3.59-.125 1.262.046 2.73.814 4.484.128.01.257.025.386.043a6.364 6.364 0 013.327 1.506c.916.79 1.743 1.921 2.414 3.5z"/>
          </svg>
        </button>
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

    const obsidianBtn = header.querySelector(`#${GemiBoost.Config.DOM_IDS.OBSIDIAN_BTN}`);
    if (obsidianBtn) {
      obsidianBtn.addEventListener('click', () => {
        if (onObsidian) onObsidian();
      });
    }

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
    const scroller = GemiBoost.Utils && GemiBoost.Utils.getChatScrollContainer ? GemiBoost.Utils.getChatScrollContainer() : null;
    if (!scroller) return;

    this._scrollSpyBound = true;
    const onScroll = GemiBoost.Utils.debounce(() => {
      this.updateActiveItem();
    }, 150);

    scroller.addEventListener('scroll', onScroll, { passive: true });
  },

  // Highlight TOC item corresponding to current viewport position
  updateActiveItem: function () {
    // Suppress scroll spy updates while active auto-navigation is in progress
    if (this._isNavigating) return;

    const scroller = GemiBoost.Utils && GemiBoost.Utils.getChatScrollContainer ? GemiBoost.Utils.getChatScrollContainer() : null;
    if (!scroller) return;
    const queries = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
    if (queries.length === 0) return;

    const scrollerRect = scroller.getBoundingClientRect();
    let activeQuery = null;

    for (let i = 0; i < queries.length; i++) {
      const rect = queries[i].getBoundingClientRect();
      if (rect.top <= scrollerRect.top + 250) {
        activeQuery = queries[i];
      } else {
        break;
      }
    }

    if (!activeQuery && queries.length > 0) activeQuery = queries[0];
    if (!activeQuery) return;

    const activeIndex = this.inferQueryIndex(activeQuery);
    if (activeIndex === -1) return;

    const list = document.getElementById(GemiBoost.Config.DOM_IDS.LIST);
    if (!list) return;

    const currentActive = list.querySelector('.gemiboost-toc-item.is-active');
    if (currentActive && parseInt(currentActive.dataset.queryIndex, 10) === activeIndex) {
      return; // Already active, zero DOM touch
    }

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

  // Update Obsidian export button state in top header
  setObsidianButtonState: function (state, tooltip) {
    const obsidianBtn = document.getElementById(GemiBoost.Config.DOM_IDS.OBSIDIAN_BTN);
    if (!obsidianBtn) return;

    const strings = this.getStrings();
    const defaultTooltip =
      state === 'syncing'
        ? strings.obsidianSyncing
        : state === 'loading'
        ? strings.obsidianLoading
        : state === 'success'
        ? strings.obsidianSuccess
        : strings.obsidianIdle;

    const finalTooltip = tooltip || defaultTooltip;
    obsidianBtn.dataset.state = state;

    if (state === 'syncing' || state === 'loading') {
      obsidianBtn.classList.remove('is-success');
      obsidianBtn.classList.add('is-loading');
      obsidianBtn.innerHTML = `
        <span class="gemiboost-spinner-composited">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" stroke-dasharray="40 18" />
          </svg>
        </span>
      `;
    } else if (state === 'success') {
      obsidianBtn.classList.remove('is-loading');
      obsidianBtn.classList.add('is-success');
      obsidianBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
      `;
    } else {
      obsidianBtn.classList.remove('is-loading', 'is-success');
      obsidianBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="currentColor">
          <path d="M9.643 14.012c.615-.183 1.605-.465 2.745-.534-.684-1.725-.849-3.235-.716-4.579.153-1.552.7-2.847 1.234-3.95.114-.235.223-.454.328-.664.149-.297.289-.577.42-.86.217-.47.378-.885.46-1.27.08-.38.08-.719-.014-1.044-.095-.325-.297-.675-.681-1.06a1.6 1.6 0 00-1.475.36l-4.95 4.453a1.602 1.602 0 00-.512.952l-.427 2.83c.67.592 2.327 2.317 3.335 4.71.09.213.174.432.253.656zM5.855 9.937c-.024.1-.057.197-.099.29L3.14 16.058a1.602 1.602 0 00.313 1.772l4.117 4.24c2.102-3.102 1.795-6.02.835-8.3-.728-1.73-1.832-3.083-2.55-3.833z"/>
          <path d="M8.52 22.57c.073.01.146.018.22.02.781.023 2.095.091 3.16.288.87.16 2.593.642 4.011 1.056 1.082.316 2.197-.548 2.354-1.664.115-.814.33-1.735.725-2.58l-.009.004c-.67-1.87-1.523-3.077-2.417-3.847a5.294 5.294 0 00-2.777-1.258c-1.541-.216-2.952.189-3.841.45.532 2.218.368 4.828-1.425 7.53z"/>
          <path d="M19.676 18.538a69.072 69.072 0 001.858-2.952.811.811 0 00-.061-.901c-.516-.684-1.504-2.075-2.042-3.362-.554-1.323-.636-3.378-.64-4.378a1.708 1.708 0 00-.359-1.051L15.235 1.83a3.757 3.757 0 01-.076.545c-.107.503-.307 1.004-.536 1.498-.135.29-.29.601-.446.915-.105.21-.21.42-.31.626-.517 1.068-.998 2.227-1.132 3.59-.125 1.262.046 2.73.814 4.484.128.01.257.025.386.043a6.364 6.364 0 013.327 1.506c.916.79 1.743 1.921 2.414 3.5z"/>
        </svg>
      `;
    }

    obsidianBtn.setAttribute('title', finalTooltip);
    obsidianBtn.setAttribute('aria-label', finalTooltip);
  },

  // Show Material Design 3 interactive modal for Obsidian folder and note title confirmation
  showObsidianModal: function (options = {}) {
    const { title = '', defaultFolder = 'Gemini', historyFolders = [], onConfirm, onCancel } = options;
    const strings = this.getStrings();

    // Close any existing modal first
    const existing = document.getElementById('gemiboost-obsidian-modal');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const overlay = document.createElement('div');
    overlay.id = 'gemiboost-obsidian-modal';
    overlay.className = 'gemiboost-modal-overlay';

    // Build history chips HTML
    const foldersToDisplay = Array.from(new Set([defaultFolder, ...(Array.isArray(historyFolders) ? historyFolders : [])]))
      .filter(Boolean)
      .slice(0, 5);

    let chipsHtml = '';
    if (foldersToDisplay.length > 0) {
      const chipButtons = foldersToDisplay
        .map(
          (f) =>
            `<button type="button" class="gemiboost-modal-chip" data-folder="${f}">📁 ${f}</button>`
        )
        .join('');
      chipsHtml = `
        <div class="gemiboost-modal-chips-row">
          <span class="gemiboost-modal-chips-label">${strings.obsidianModalRecentLabel}</span>
          <div class="gemiboost-modal-chips-list">${chipButtons}</div>
        </div>
      `;
    }

    overlay.innerHTML = `
      <div class="gemiboost-modal-card" role="dialog" aria-modal="true" aria-labelledby="gemiboost-modal-title">
        <div class="gemiboost-modal-header">
          <div class="gemiboost-modal-brand">
            <span class="gemiboost-modal-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M9.643 14.012c.615-.183 1.605-.465 2.745-.534-.684-1.725-.849-3.235-.716-4.579.153-1.552.7-2.847 1.234-3.95.114-.235.223-.454.328-.664.149-.297.289-.577.42-.86.217-.47.378-.885.46-1.27.08-.38.08-.719-.014-1.044-.095-.325-.297-.675-.681-1.06a1.6 1.6 0 00-1.475.36l-4.95 4.453a1.602 1.602 0 00-.512.952l-.427 2.83c.67.592 2.327 2.317 3.335 4.71.09.213.174.432.253.656zM5.855 9.937c-.024.1-.057.197-.099.29L3.14 16.058a1.602 1.602 0 00.313 1.772l4.117 4.24c2.102-3.102 1.795-6.02.835-8.3-.728-1.73-1.832-3.083-2.55-3.833z"/>
                <path d="M8.52 22.57c.073.01.146.018.22.02.781.023 2.095.091 3.16.288.87.16 2.593.642 4.011 1.056 1.082.316 2.197-.548 2.354-1.664.115-.814.33-1.735.725-2.58l-.009.004c-.67-1.87-1.523-3.077-2.417-3.847a5.294 5.294 0 00-2.777-1.258c-1.541-.216-2.952.189-3.841.45.532 2.218.368 4.828-1.425 7.53z"/>
                <path d="M19.676 18.538a69.072 69.072 0 001.858-2.952.811.811 0 00-.061-.901c-.516-.684-1.504-2.075-2.042-3.362-.554-1.323-.636-3.378-.64-4.378a1.708 1.708 0 00-.359-1.051L15.235 1.83a3.757 3.757 0 01-.076.545c-.107.503-.307 1.004-.536 1.498-.135.29-.29.601-.446.915-.105.21-.21.42-.31.626-.517 1.068-.998 2.227-1.132 3.59-.125 1.262.046 2.73.814 4.484.128.01.257.025.386.043a6.364 6.364 0 013.327 1.506c.916.79 1.743 1.921 2.414 3.5z"/>
              </svg>
            </span>
            <span id="gemiboost-modal-title" class="gemiboost-modal-title">${strings.obsidianModalTitle}</span>
          </div>
          <button type="button" class="gemiboost-modal-close" aria-label="${strings.closeTitle}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
          </button>
        </div>

        <div class="gemiboost-modal-body">
          <!-- 1. Note Title input (Primary identity) -->
          <div class="gemiboost-modal-field">
            <label for="gemiboost-input-title" class="gemiboost-modal-label">${strings.obsidianModalTitleLabel}</label>
            <div class="gemiboost-modal-input-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
              </svg>
              <input type="text" id="gemiboost-input-title" class="gemiboost-modal-input" value="${title || ''}" spellcheck="false" autocomplete="off">
            </div>
          </div>

          <!-- 2. Target Folder input (Storage destination) -->
          <div class="gemiboost-modal-field" style="margin-top: 14px;">
            <label for="gemiboost-input-folder" class="gemiboost-modal-label">${strings.obsidianModalFolderLabel}</label>
            <div class="gemiboost-modal-input-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
              <input type="text" id="gemiboost-input-folder" class="gemiboost-modal-input" placeholder="${strings.obsidianModalFolderPlaceholder}" value="${defaultFolder || 'Gemini'}" spellcheck="false" autocomplete="off">
            </div>
          </div>

          <!-- 3. History chips for folder -->
          ${chipsHtml}

          <!-- 4. Remember folder as default & don't ask again checkbox -->
          <label class="gemiboost-modal-checkbox-row">
            <input type="checkbox" id="gemiboost-input-setdefault" class="gemiboost-modal-checkbox">
            <span class="gemiboost-modal-checkbox-label">${strings.obsidianModalSetDefault}</span>
          </label>
        </div>

        <div class="gemiboost-modal-footer">
          <button type="button" class="gemiboost-modal-btn gemiboost-modal-btn-cancel">${strings.cancelBtn}</button>
          <button type="button" class="gemiboost-modal-btn gemiboost-modal-btn-confirm">${strings.confirmExportBtn}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const folderInput = overlay.querySelector('#gemiboost-input-folder');
    const titleInput = overlay.querySelector('#gemiboost-input-title');
    const setDefaultCheckbox = overlay.querySelector('#gemiboost-input-setdefault');
    const cancelBtn = overlay.querySelector('.gemiboost-modal-btn-cancel');
    const confirmBtn = overlay.querySelector('.gemiboost-modal-btn-confirm');
    const closeBtn = overlay.querySelector('.gemiboost-modal-close');

    // Click history chips to quickly fill folder
    const chips = overlay.querySelectorAll('.gemiboost-modal-chip');
    chips.forEach((ch) => {
      ch.addEventListener('click', () => {
        const target = ch.getAttribute('data-folder');
        if (target && folderInput) {
          folderInput.value = target;
          folderInput.focus();
        }
      });
    });

    const closeModal = () => {
      document.removeEventListener('keydown', handleKeyDown);
      overlay.classList.add('is-closing');
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 180);
    };

    const handleConfirm = () => {
      const chosenFolder = folderInput ? folderInput.value.trim() || 'Gemini' : 'Gemini';
      const chosenTitle = titleInput ? titleInput.value.trim() || title : title;
      const setAsDefault = setDefaultCheckbox ? setDefaultCheckbox.checked : false;
      closeModal();
      if (onConfirm) {
        onConfirm({ folder: chosenFolder, title: chosenTitle, setAsDefault });
      }
    };

    const handleCancel = () => {
      closeModal();
      if (onCancel) onCancel();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };

    // Close when clicking outside card (on overlay backdrop)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        handleCancel();
      }
    });

    if (closeBtn) closeBtn.addEventListener('click', handleCancel);
    if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
    if (confirmBtn) confirmBtn.addEventListener('click', handleConfirm);

    document.addEventListener('keydown', handleKeyDown);

    // Auto-focus folder input
    setTimeout(() => {
      if (folderInput) {
        folderInput.focus();
        folderInput.select();
      }
    }, 60);
  },

  // Render list of items into TOC list container
  renderList: function (items, onItemClick) {
    this._items = items || [];
    const list = document.getElementById(GemiBoost.Config.DOM_IDS.LIST);
    if (!list) return;

    const strings = this.getStrings();
    const badge = document.getElementById('gemiboost-toc-badge');

    // Update header turn count badge
    if (badge) {
      if (items && items.length > 0) {
        const uniqueTurns = items.filter((it) => it.isTurnRoot !== false).length;
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

    let turnCounter = 0;

    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = item.className || 'gemiboost-toc-item';
      li.dataset.queryIndex = item.queryIndex !== undefined ? String(item.queryIndex) : '';
      if (item.subIndex !== undefined) {
        li.dataset.subIndex = String(item.subIndex);
      }
      if (item.title) li.title = item.title;

      // 1. Leading Slot: Turn Number Badge (for turn root) or blank indentation spacer (for attachments)
      const leading = document.createElement('div');
      leading.className = 'gemiboost-item-leading';

      const isTurnRoot = typeof item.isTurnRoot === 'boolean'
        ? item.isTurnRoot
        : (item.subIndex === undefined || item.subIndex === null);

      if (isTurnRoot) {
        turnCounter++;
        li.dataset.isTurnRoot = 'true';
        const badgeStr = turnCounter < 10 ? '0' + turnCounter : String(turnCounter);
        leading.innerHTML = `<span class="gemiboost-turn-badge">${badgeStr}</span>`;
      } else {
        li.dataset.isTurnRoot = 'false';
        // Empty leading spacer providing exact indentation alignment with the turn badge above
        leading.innerHTML = '';
      }

      // 2. Text Content Area: Prompt text or attachment with icon aligned with prompt text
      const content = document.createElement('div');
      content.className = 'gemiboost-item-content';

      const textSpan = document.createElement('span');
      textSpan.className = 'gemiboost-item-text';

      // Insert attachment icon for image or file items (aligned with prompt text)
      if (item.type === 'image') {
        const imgIcon = document.createElement('span');
        imgIcon.className = 'gemiboost-inline-icon gemiboost-icon-image';
        imgIcon.title = strings.imageLabel;
        imgIcon.innerHTML = this.getAttachmentIconSvg('image');
        textSpan.appendChild(imgIcon);
      } else if (item.type === 'file') {
        const category = item.fileCategory || (GemiBoost.Extractor && GemiBoost.Extractor.detectFileCategory
          ? GemiBoost.Extractor.detectFileCategory(item.fileType, item.fileName)
          : 'file');

        const fileIcon = document.createElement('span');
        fileIcon.className = `gemiboost-inline-icon gemiboost-icon-${category}`;
        fileIcon.title = item.fileType || strings.fileLabel;
        fileIcon.innerHTML = this.getAttachmentIconSvg(category);
        textSpan.appendChild(fileIcon);
      }

      let displayContent = item.display || '';
      if (item.type === 'image') {
        const isPlaceholder = (val) => {
          if (!val) return true;
          const clean = val.trim().toLowerCase();
          return (
            clean === 'uploaded image preview' ||
            clean === 'uploaded image' ||
            clean === 'image preview' ||
            clean === 'preview image' ||
            clean === 'preview' ||
            clean === 'image' ||
            clean === '[image]' ||
            clean === '图片' ||
            clean === '上传的图片预览' ||
            clean === '图片预览'
          );
        };

        if (item.isDefaultName || isPlaceholder(displayContent) || !displayContent) {
          const total = item.totalImages || 1;
          const idx = item.imageIndex !== undefined ? item.imageIndex : (item.subIndex || 0);
          const base = total > 1 ? `${strings.imageLabel} ${idx + 1}` : strings.imageLabel;
          displayContent = `[IMG] ${base}`;
        }
      }

      if (item.type === 'file' || item.type === 'image') {
        const tagMatch = displayContent.match(/^(\[[^\]]+\])\s*(.*)$/);
        if (tagMatch) {
          const category = item.fileCategory || (GemiBoost.Extractor && GemiBoost.Extractor.detectFileCategory
            ? GemiBoost.Extractor.detectFileCategory(item.fileType, item.fileName)
            : (item.type === 'image' ? 'image' : 'file'));
          const tagSpan = document.createElement('span');
          tagSpan.className = `gemiboost-type-tag gemiboost-type-tag-${category}`;
          tagSpan.textContent = tagMatch[1];
          textSpan.appendChild(tagSpan);
          if (tagMatch[2]) {
            textSpan.appendChild(document.createTextNode(' ' + tagMatch[2]));
          }
        } else {
          textSpan.appendChild(document.createTextNode(displayContent));
        }
      } else {
        textSpan.appendChild(document.createTextNode(displayContent));
      }
      content.appendChild(textSpan);

      li.appendChild(leading);
      li.appendChild(content);

      li.addEventListener('click', () => {
        if (onItemClick) onItemClick(item);
      });

      list.appendChild(li);
    });

    list.scrollTop = currentScrollTop;
    this.updateActiveItem();
  },

  // Get SVG markup for a given attachment category
  getAttachmentIconSvg: function (category) {
    switch (category) {
      case 'folder':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
      case 'code':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>';
      case 'pdf':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9.5 8.5c0 .83-.67 1.5-1.5 1.5H7v2H5.5V8H8c.83 0 1.5.67 1.5 1.5v2zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V8H13c.83 0 1.5.67 1.5 1.5v4zm4-3.5H17v1h1.5v1.5H17v2h-1.5V8h3v1.5z"/></svg>';
      case 'table':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 7h14v2H5V7zm0 4h6v8H5v-8zm14 8h-6v-8h6v8z"/></svg>';
      case 'text':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>';
      case 'audio':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
      case 'video':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-10 12.5v-9l6 4.5-6 4.5z"/></svg>';
      case 'archive':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10h-2v-2h2v2zm0-4h-2v-2h2v2zm-2-4V6h2v2h-2z"/></svg>';
      case 'image':
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
      case 'file':
      default:
        return '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
    }
  },

  // Extract and clean raw prompt text from a query DOM node, stripping hidden screen reader labels
  getCleanPromptText: function (queryEl) {
    return GemiBoost.Utils ? GemiBoost.Utils.getCleanPromptText(queryEl) : '';
  },

  // Strip leading slash command or skill identifier (e.g. "/multi-subagent-search ")
  stripSlashCommand: function (text) {
    return GemiBoost.Utils ? GemiBoost.Utils.stripSlashCommand(text) : (text || '');
  },

  // Infer the global queryIndex of a given DOM query element by matching with TOC list
  inferQueryIndex: function (queryEl) {
    if (!queryEl) return -1;

    // 0. Direct dataset attribute check (O(1))
    if (queryEl.dataset && queryEl.dataset.gbQueryIndex !== undefined) {
      const idx = parseInt(queryEl.dataset.gbQueryIndex, 10);
      if (!isNaN(idx)) return idx;
    }

    const qText = this.getCleanPromptText(queryEl);
    if (!qText) return -1;

    // 1. In-memory lookup via cached items
    if (this._items && this._items.length > 0) {
      // 1A. Exact full-text match
      for (const item of this._items) {
        if (item.rawText && item.rawText.trim() === qText.trim()) {
          if (typeof item.queryIndex === 'number') return item.queryIndex;
        }
      }

      // 1B. Payload match (stripping slash commands to prevent collision)
      const qPayload = this.stripSlashCommand(qText);
      if (qPayload && qPayload.length >= 3) {
        for (const item of this._items) {
          const itemPayload = this.stripSlashCommand(item.rawText || item.title || '');
          if (itemPayload && itemPayload === qPayload) {
            if (typeof item.queryIndex === 'number') return item.queryIndex;
          }
        }
      }

      // 1C. Best overlap match (scored, not short-circuited)
      let bestItem = null;
      let maxOverlap = 0;
      for (const item of this._items) {
        const itemPayload = this.stripSlashCommand(item.rawText || item.title || '');
        if (qPayload && itemPayload) {
          let overlap = 0;
          const minLen = Math.min(qPayload.length, itemPayload.length);
          while (overlap < minLen && qPayload[overlap] === itemPayload[overlap]) {
            overlap++;
          }
          if (overlap > 15 && overlap > maxOverlap) {
            maxOverlap = overlap;
            bestItem = item;
          }
        }
      }
      if (bestItem && typeof bestItem.queryIndex === 'number') {
        return bestItem.queryIndex;
      }
    }

    // 2. Fallback to DOM if in-memory cache misses
    const list = document.getElementById(GemiBoost.Config.DOM_IDS.LIST);
    if (!list) return -1;

    const items = list.querySelectorAll('.gemiboost-toc-item');
    for (const li of items) {
      const title = li.title || '';
      if (title && (title.trim() === qText.trim())) {
        const idx = parseInt(li.dataset.queryIndex, 10);
        if (!isNaN(idx)) return idx;
      }
    }
    return -1;
  },

  // Locate the target DOM element for a given TOC item (prompt container or specific attachment)
  findTargetElement: function (item) {
    if (!item) return null;
    const queries = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
    if (queries.length === 0) return null;

    let targetQuery = null;

    // Tier 1: Direct DOM dataset attribute match (O(1) exact query index match)
    if (typeof item.queryIndex === 'number') {
      const directEl = document.querySelector(`${GemiBoost.Config.SELECTORS.USER_QUERY}[data-gb-query-index="${item.queryIndex}"]`);
      if (directEl) {
        if (!item.rawText) {
          targetQuery = directEl;
        } else {
          const directText = this.getCleanPromptText(directEl);
          if (directText === item.rawText) {
            targetQuery = directEl;
          } else {
            const directPayload = this.stripSlashCommand(directText);
            const itemPayload = this.stripSlashCommand(item.rawText);
            if (directPayload && itemPayload && directPayload === itemPayload) {
              targetQuery = directEl;
            }
          }
        }
      }
    }

    // Tier 2: Exact Full-Text Match (Cleaned)
    if (!targetQuery && item.rawText) {
      const targetText = item.rawText.trim();
      const exactMatches = queries.filter((q) => {
        const qText = this.getCleanPromptText(q);
        return qText === targetText;
      });

      if (exactMatches.length === 1) {
        targetQuery = exactMatches[0];
      } else if (exactMatches.length > 1) {
        // Multiple identical queries (e.g. repeated "继续"): pick closest to item.queryIndex
        let bestCandidate = exactMatches[0];
        let minDiff = Infinity;
        for (const candidate of exactMatches) {
          const candidateIdx = queries.indexOf(candidate);
          const diff = Math.abs(candidateIdx - (item.queryIndex || 0));
          if (diff < minDiff) {
            minDiff = diff;
            bestCandidate = candidate;
          }
        }
        targetQuery = bestCandidate;
      }
    }

    // Tier 3: Payload Text Match (Stripping Slash Command / Skill prefix)
    if (!targetQuery && item.rawText) {
      const itemPayload = this.stripSlashCommand(item.rawText);
      if (itemPayload && itemPayload.length >= 3) {
        const payloadMatches = queries.filter((q) => {
          const qText = this.getCleanPromptText(q);
          const qPayload = this.stripSlashCommand(qText);
          return qPayload === itemPayload || (qPayload && qPayload.startsWith(itemPayload)) || (itemPayload.startsWith(qPayload));
        });

        if (payloadMatches.length === 1) {
          targetQuery = payloadMatches[0];
        } else if (payloadMatches.length > 1) {
          let bestCandidate = payloadMatches[0];
          let minDiff = Infinity;
          for (const candidate of payloadMatches) {
            const candidateIdx = queries.indexOf(candidate);
            const diff = Math.abs(candidateIdx - (item.queryIndex || 0));
            if (diff < minDiff) {
              minDiff = diff;
              bestCandidate = candidate;
            }
          }
          targetQuery = bestCandidate;
        }
      }
    }

    // Tier 4: Long Prefix / Substring Match (Score-based, best match wins, NOT first match)
    if (!targetQuery && item.rawText) {
      const targetText = item.rawText.trim();
      let bestCandidate = null;
      let maxOverlap = 0;

      for (const q of queries) {
        const qText = this.getCleanPromptText(q);
        if (!qText) continue;

        const qPayload = this.stripSlashCommand(qText);
        const itemPayload = this.stripSlashCommand(targetText);

        if (qPayload && itemPayload) {
          let overlap = 0;
          const minLen = Math.min(qPayload.length, itemPayload.length);
          while (overlap < minLen && qPayload[overlap] === itemPayload[overlap]) {
            overlap++;
          }
          if (overlap > 10 && overlap > maxOverlap) {
            maxOverlap = overlap;
            bestCandidate = q;
          }
        }
      }

      if (bestCandidate) {
        targetQuery = bestCandidate;
      }
    }

    // Tier 5: Direct queryIndex fallback
    if (!targetQuery && typeof item.queryIndex === 'number') {
      if (item.queryIndex < queries.length) {
        targetQuery = queries[item.queryIndex];
      }
    }

    if (!targetQuery) return null;

    // Resolve sub-element for image or file attachments
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
      return validImgs[item.subIndex || 0] || targetQuery;
    }

    if (item.type === 'file') {
      const rawFiles = Array.from(targetQuery.querySelectorAll(GemiBoost.Config.SELECTORS.FILE_CONTAINER));
      const files = rawFiles.filter((el) => !rawFiles.some((other) => other !== el && other.contains(el)));
      return files[item.subIndex || 0] || targetQuery;
    }

    return targetQuery;
  },

  // Hardware-synchronized 60fps/120fps ease-out cubic scroll animation
  animateScrollTo: function (scroller, targetTop, duration, onComplete) {
    if (!scroller) return () => {};

    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const boundedTarget = Math.max(0, Math.min(maxScroll, Math.round(targetTop)));
    const startTop = scroller.scrollTop;
    const distance = boundedTarget - startTop;

    if (Math.abs(distance) < 2) {
      scroller.scrollTop = boundedTarget;
      if (onComplete) onComplete();
      return () => {};
    }

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const startTime = performance.now();
    let rafId = null;
    let isCanceled = false;

    const tick = (currentTime) => {
      if (isCanceled) return;

      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / duration);
      const easedProgress = easeOutCubic(progress);

      scroller.scrollTop = Math.round(startTop + distance * easedProgress);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        scroller.scrollTop = boundedTarget;
        if (onComplete) onComplete();
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      isCanceled = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  },

  // Silky 60fps/120fps progressive auto-navigation controller: cruises to any distance in a single click
  navigateToItem: function (item, onUpdateCatalog) {
    if (GemiBoost.Sync && GemiBoost.Sync.isCurrentlySyncing()) {
      return;
    }

    const scroller = GemiBoost.Utils && GemiBoost.Utils.getChatScrollContainer ? GemiBoost.Utils.getChatScrollContainer() : null;
    if (!scroller) return;

    // 1. Cancel any active animation and reset previous navigation state
    if (this._cancelAnimation) {
      this._cancelAnimation();
      this._cancelAnimation = null;
    }

    this._isNavigating = true;
    const clickTime = performance.now();
    const minFeedbackDurationMs = 380; // Ensure visible feedback even for 0px distance

    // 2. Update active highlight in the sidebar list immediately
    const list = document.getElementById(GemiBoost.Config.DOM_IDS.LIST);
    if (list) {
      const allItems = list.querySelectorAll('.gemiboost-toc-item');
      allItems.forEach((el) => {
        const matchesQuery = String(item.queryIndex) === el.dataset.queryIndex;
        const elSub = el.dataset.subIndex || '';
        const itemSub = item.subIndex !== undefined ? String(item.subIndex) : '';
        const isExactTarget = matchesQuery && elSub === itemSub;
        const isTurnRoot = matchesQuery && (el.dataset.isTurnRoot === 'true' || elSub === '');

        // Active state: target item and its turn root badge are active
        if (isExactTarget || isTurnRoot) {
          el.classList.add('is-active');
        } else {
          el.classList.remove('is-active');
        }

        // Navigating flight background: ONLY the exact clicked row
        if (isExactTarget) {
          el.classList.add('is-navigating');
        } else {
          el.classList.remove('is-navigating');
        }
      });
    }

    // Helper to fade away temporary navigation row background after minimum feedback time
    const clearNavigatingState = (immediate = false) => {
      const doClear = () => {
        if (list) {
          const navItems = list.querySelectorAll('.gemiboost-toc-item.is-navigating');
          navItems.forEach((el) => el.classList.remove('is-navigating'));
        }
      };

      if (immediate) {
        doClear();
      } else {
        const elapsed = performance.now() - clickTime;
        const remaining = Math.max(0, minFeedbackDurationMs - elapsed);
        if (remaining > 0) {
          setTimeout(doClear, remaining);
        } else {
          doClear();
        }
      }
    };

    // 3. User manual interrupt handler (mouse wheel, touch or keydown gracefully abort auto-navigation)
    const onUserInterrupt = (e) => {
      if (e.target && e.target.closest && e.target.closest('#gemiboost-toc-container')) {
        return; // Allow scrolling inside the sidebar itself
      }
      cleanup(true);
    };

    const cleanup = (immediate = false) => {
      clearNavigatingState(immediate);
      if (this._cancelAnimation) {
        this._cancelAnimation();
        this._cancelAnimation = null;
      }
      this._isNavigating = false;
      window.removeEventListener('wheel', onUserInterrupt, { capture: true });
      window.removeEventListener('touchstart', onUserInterrupt, { capture: true });
      window.removeEventListener('keydown', onUserInterrupt, { capture: true });
    };

    window.addEventListener('wheel', onUserInterrupt, { capture: true, passive: true });
    window.addEventListener('touchstart', onUserInterrupt, { capture: true, passive: true });
    window.addEventListener('keydown', onUserInterrupt, { capture: true, passive: true });

    // Precision landing helper when target DOM element is available
    const landOnTarget = (targetEl) => {
      if (!targetEl) {
        cleanup();
        return;
      }

      const targetRect = targetEl.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const isAttachment = item.type === 'image' || item.type === 'file';
      const desiredTop = isAttachment
        ? Math.max(80, (scrollerRect.height - targetRect.height) / 2)
        : 80;

      const delta = (targetRect.top - scrollerRect.top) - desiredTop;
      const targetScrollTop = scroller.scrollTop + delta;
      const distance = Math.abs(delta);

      // Dynamic duration based on square root of distance (260ms - 520ms)
      const duration = Math.min(520, Math.max(260, Math.round(200 + Math.sqrt(distance) * 4.2)));

      this._cancelAnimation = this.animateScrollTo(scroller, targetScrollTop, duration, () => {
        // Arrival check: micro-settle if layout shifted during flight
        const freshTarget = this.findTargetElement(item) || targetEl;
        const freshTargetRect = freshTarget.getBoundingClientRect();
        const freshDelta = (freshTargetRect.top - scrollerRect.top) - desiredTop;

        if (Math.abs(freshDelta) > 15) {
          this._cancelAnimation = this.animateScrollTo(scroller, scroller.scrollTop + freshDelta, 140, () => {
            if (onUpdateCatalog) onUpdateCatalog();
            cleanup(false);
          });
        } else {
          if (onUpdateCatalog) onUpdateCatalog();
          cleanup(false);
        }
      });
    };

    // Check if target is already in DOM
    const initialTargetEl = this.findTargetElement(item);
    if (initialTargetEl) {
      landOnTarget(initialTargetEl);
      return;
    }

    // Target not in DOM yet (virtualized): smooth hydration glide towards target's estimated location
    const queries = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
    let scrollUp = true;
    if (queries.length > 0 && typeof item.queryIndex === 'number') {
      const firstIdx = this.inferQueryIndex(queries[0]);
      if (firstIdx !== -1) {
        scrollUp = item.queryIndex < firstIdx;
      } else {
        scrollUp = scroller.scrollTop > 300;
      }
    } else {
      scrollUp = scroller.scrollTop > 300;
    }

    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const searchTarget = scrollUp ? 0 : maxScroll;
    const searchDistance = Math.abs(searchTarget - scroller.scrollTop);
    const searchDuration = Math.min(650, Math.max(320, Math.round(240 + Math.sqrt(searchDistance) * 4.5)));

    // Continuous RAF hydration loop: glides toward boundary and checks for element appearance
    let frameCount = 0;
    const startTop = scroller.scrollTop;
    const searchDelta = searchTarget - startTop;
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    const searchStartTime = performance.now();
    let searchRafId = null;

    const searchStep = (currentTime) => {
      frameCount++;
      const elapsed = currentTime - searchStartTime;
      const progress = Math.min(1, elapsed / searchDuration);
      const easedProgress = easeOutCubic(progress);

      scroller.scrollTop = Math.round(startTop + searchDelta * easedProgress);

      // Check every 4 frames (~60ms) if target element has been hydrated into DOM
      if (frameCount % 4 === 0) {
        const foundEl = this.findTargetElement(item);
        if (foundEl) {
          cancelAnimationFrame(searchRafId);
          searchRafId = null;
          landOnTarget(foundEl);
          return;
        }
      }

      if (progress < 1) {
        searchRafId = requestAnimationFrame(searchStep);
      } else {
        // Search finished reaching boundary; final check after slight pause for DOM render
        setTimeout(() => {
          const finalFound = this.findTargetElement(item);
          if (finalFound) {
            landOnTarget(finalFound);
          } else {
            if (onUpdateCatalog) onUpdateCatalog();
            cleanup(false);
          }
        }, 80);
      }
    };

    searchRafId = requestAnimationFrame(searchStep);
    this._cancelAnimation = () => {
      if (searchRafId !== null) {
        cancelAnimationFrame(searchRafId);
        searchRafId = null;
      }
    };
  },

  // Backwards-compatible standalone scroll method
  scrollToTargetElement: function (targetQuery, item) {
    const targetEl = this.findTargetElement(item) || targetQuery;
    if (!targetEl) return;
    this.navigateToItem(item);
  }
};
