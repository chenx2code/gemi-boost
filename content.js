// content.js
// Main entry point and coordinator for GemiBoost

window.GemiBoost = window.GemiBoost || {};

GemiBoost.App = {
  isCatalogOpen: false,
  currentUrl: location.href,
  cachedChatData: null,
  lastQueryCount: 0,
  lastSignature: '',
  initAttempts: 0,

  // Initialize extension on page load
  init: function () {
    console.log('GemiBoost: Initializing content script...');
    this.tryInjectUI();
  },

  // Attempt to mount the UI container and toggle button
  tryInjectUI: function () {
    const mainContainer = document.querySelector(GemiBoost.Config.SELECTORS.MAIN_CONTAINER);

    if (mainContainer) {
      this.createUI();
      this.mountButton();
      this.observeDOM();

      // Quick retry mounting toggle button as soon as Angular renders toolbar
      const retryMountButton = (attempts = 0) => {
        if (attempts >= GemiBoost.Config.TIMING.MOUNT_BUTTON_MAX_ATTEMPTS || document.getElementById(GemiBoost.Config.DOM_IDS.TOGGLE_BTN)) {
          return;
        }
        this.mountButton();
        setTimeout(() => retryMountButton(attempts + 1), GemiBoost.Config.TIMING.MOUNT_BUTTON_RETRY_MS);
      };
      retryMountButton();

      const chatId = GemiBoost.Utils.getChatId();
      if (chatId) {
        GemiBoost.Storage.loadChatCache(chatId, (cached) => {
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
        console.warn('GemiBoost: Could not find <bard-sidenav-container>. Injection failed.');
      }
    }
  },

  // Create drawer UI and bind header actions
  createUI: function () {
    GemiBoost.UI.ensureDrawerUI({
      onClose: () => this.toggleCatalog(false),
      onSync: () => this.handleSync(),
      onExport: () => this.handleExport()
    });
  },

  // Trigger conversation export to Markdown
  handleExport: function () {
    if (GemiBoost.Exporter) {
      GemiBoost.Exporter.exportToMarkdown();
    }
  },

  // Mount or reposition toggle button in top bar
  mountButton: function () {
    GemiBoost.UI.mountToggleButton({
      onClick: () => this.toggleCatalog(!this.isCatalogOpen)
    });
  },

  // Trigger or cancel full history sync
  handleSync: function () {
    // Invalidate memory signatures to force full re-render on completion
    this.cachedChatData = null;
    this.lastSignature = '';
    this.lastQueryCount = 0;

    GemiBoost.Sync.triggerSync({
      onBatchLoaded: () => {
        this.updateCatalog();
      },
      onComplete: (fullItems) => {
        this.cachedChatData = { items: fullItems, isFullySynced: true, updatedAt: Date.now() };
        this.updateCatalog();
      },
      onAborted: () => {
        this.updateCatalog();
      }
    });
  },

  // Open or close TOC sidebar
  toggleCatalog: function (show) {
    this.isCatalogOpen = show;
    GemiBoost.UI.setDrawerVisible(show);

    if (show) {
      this.updateCatalog();
    } else {
      this.mountButton();
    }
  },

  // Update TOC list by extracting DOM, merging with cache, and re-rendering
  updateCatalog: function () {
    const list = document.getElementById(GemiBoost.Config.DOM_IDS.LIST);
    if (!list) return;

    const domItems = GemiBoost.Extractor.extractFromDOM();
    const mergeResult = GemiBoost.Storage.mergeWithCache(domItems, this.cachedChatData);

    if (mergeResult.isCorrupted) {
      this.cachedChatData = null;
    } else if (mergeResult.hasChanges && this.cachedChatData) {
      this.cachedChatData.items = mergeResult.updatedList;
      const chatId = GemiBoost.Utils.getChatId();
      if (chatId) {
        GemiBoost.Storage.saveChatCache(chatId, mergeResult.updatedList, true);
      }
    }

    const finalItems = mergeResult.items;

    if (finalItems.length === 0) {
      if (this.lastQueryCount === 0 && this.lastSignature === 'empty') return;
      this.lastQueryCount = 0;
      this.lastSignature = 'empty';
      GemiBoost.UI.renderList([], null);
      return;
    }

    const signature = finalItems.map((it) => `${it.queryIndex}:${it.type}:${it.display}`).join('|');
    if (signature === this.lastSignature && finalItems.length === this.lastQueryCount) {
      return;
    }

    this.lastSignature = signature;
    this.lastQueryCount = finalItems.length;

    // Persist cache updates only if this chat was already fully synced
    const chatId = GemiBoost.Utils.getChatId();
    if (chatId && this.cachedChatData?.isFullySynced && !GemiBoost.Sync.isCurrentlySyncing()) {
      GemiBoost.Storage.saveChatCache(chatId, finalItems, true);
    }

    GemiBoost.UI.renderList(finalItems, (item) => {
      GemiBoost.UI.navigateToItem(item, () => this.updateCatalog());
    });
  },

  // Observe URL route changes and DOM updates in Gemini SPA
  observeDOM: function () {
    const debouncedUpdate = GemiBoost.Utils.debounce(() => {
      this.updateCatalog();
      this.mountButton();
    }, GemiBoost.Config.TIMING.DEBOUNCE_DOM_OBSERVER_MS);

    const observer = new MutationObserver((mutations) => {
      // 1. Detect SPA route navigation
      if (this.currentUrl !== location.href) {
        this.currentUrl = location.href;

        // Immediately abort any background sync from previous chat to prevent cache contamination
        GemiBoost.Sync.abortSync();

        this.lastSignature = '';
        this.lastQueryCount = 0;
        this.cachedChatData = null;

        if (this.isCatalogOpen) {
          const container = document.getElementById(GemiBoost.Config.DOM_IDS.CONTAINER);
          if (container) {
            container.style.transition = 'none';
            this.toggleCatalog(false);
            void container.offsetHeight;
            container.style.transition = '';
          } else {
            this.toggleCatalog(false);
          }
        }

        const btn = document.getElementById(GemiBoost.Config.DOM_IDS.TOGGLE_BTN);
        if (btn) btn.remove();

        const newChatId = GemiBoost.Utils.getChatId();
        if (newChatId) {
          GemiBoost.Storage.loadChatCache(newChatId, (cached) => {
            if (cached && cached.items && cached.items.length > 0) {
              this.cachedChatData = cached;
              this.updateCatalog();
            }
          });
        }
        this.mountButton();
      }

      // 2. Ensure drawer container is still in DOM (e.g. if Gemini rebuilt main container)
      if (!document.getElementById(GemiBoost.Config.DOM_IDS.CONTAINER)) {
        const mainContainer = document.querySelector(GemiBoost.Config.SELECTORS.MAIN_CONTAINER);
        if (mainContainer) {
          this.createUI();
          this.lastSignature = '';
          this.lastQueryCount = 0;
          this.updateCatalog();

          if (this.isCatalogOpen) {
            const container = document.getElementById(GemiBoost.Config.DOM_IDS.CONTAINER);
            if (container) {
              container.style.transition = 'none';
              container.classList.add('panel-visible');
              void container.offsetHeight;
              container.style.transition = '';
            }
          }
        }
      }

      // 3. Trigger debounced update if nodes were added or removed
      let shouldUpdate = false;
      for (const mutation of mutations) {
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

// Global alias for backwards compatibility
window.Catalog = GemiBoost.App;

// Auto-initialize when document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    GemiBoost.App.init();
  });
} else {
  GemiBoost.App.init();
}
