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
  _metadataUpdateTimer: null,

  // Initialize extension on page load
  init: function () {
    console.log('GemiBoost: Initializing content script...');
    if (GemiBoost.Notification) {
      GemiBoost.Notification.init();
    }
    if (GemiBoost.Extractor && GemiBoost.Extractor.setOnImageFilenamesUpdated) {
      GemiBoost.Extractor.setOnImageFilenamesUpdated(() => {
        const scheduledUrl = this.currentUrl;
        if (this._metadataUpdateTimer) {
          clearTimeout(this._metadataUpdateTimer);
        }
        this._metadataUpdateTimer = setTimeout(() => {
          this._metadataUpdateTimer = null;
          if (this.currentUrl === scheduledUrl) {
            this.updateCatalog();
          }
        }, 80);
      });
    }
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
          if (GemiBoost.Utils.getChatId() !== chatId) return;
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
      onExport: () => this.handleExport(),
      onObsidian: () => this.handleObsidianExport()
    });
  },

  // Trigger conversation export to Markdown
  handleExport: function () {
    if (GemiBoost.Exporter) {
      GemiBoost.Exporter.exportToMarkdown();
    }
  },

  // Trigger conversation export directly to Obsidian
  handleObsidianExport: function () {
    if (!GemiBoost.Exporter || !GemiBoost.Exporter.exportToObsidian) return;

    if (!GemiBoost.Storage || !GemiBoost.Storage.loadExportSettings) {
      GemiBoost.Exporter.exportToObsidian();
      return;
    }

    GemiBoost.Storage.loadExportSettings((settings) => {
      if (settings && settings.obsidianPromptFolder && GemiBoost.UI && GemiBoost.UI.showObsidianModal) {
        const title = GemiBoost.Extractor ? GemiBoost.Extractor.extractChatTitle() : '';
        const defaultFolder = (settings.obsidianFolderHistory && settings.obsidianFolderHistory[0]) || settings.obsidianFolder || 'Gemini';
        const historyFolders = settings.obsidianFolderHistory || [];

        GemiBoost.UI.showObsidianModal({
          title,
          defaultFolder,
          historyFolders,
          onConfirm: ({ folder, title: chosenTitle, setAsDefault }) => {
            if (setAsDefault) {
              // Persist as new default folder and turn off prompt mode
              const updatedSettings = {
                ...settings,
                obsidianFolder: folder,
                obsidianPromptFolder: false
              };
              let history = Array.isArray(settings.obsidianFolderHistory) ? settings.obsidianFolderHistory.slice() : ['Gemini'];
              history = [folder, ...history.filter((f) => f.toLowerCase() !== folder.toLowerCase())].slice(0, 5);
              updatedSettings.obsidianFolderHistory = history;

              if (GemiBoost.Storage.saveExportSettings) {
                GemiBoost.Storage.saveExportSettings(updatedSettings, () => {
                  GemiBoost.Exporter.exportToObsidian({ folder, title: chosenTitle });
                });
              } else {
                GemiBoost.Exporter.exportToObsidian({ folder, title: chosenTitle });
              }
            } else {
              if (GemiBoost.Storage.addObsidianFolderHistory) {
                GemiBoost.Storage.addObsidianFolderHistory(folder);
              }
              GemiBoost.Exporter.exportToObsidian({ folder, title: chosenTitle });
            }
          }
        });
      } else {
        GemiBoost.Exporter.exportToObsidian();
      }
    });
  },

  // Mount or reposition toggle button in top bar
  mountButton: function () {
    GemiBoost.UI.mountToggleButton({
      onClick: () => this.toggleCatalog(!this.isCatalogOpen)
    });
  },

  // Trigger or cancel full history sync (with instant fast-path when DOM is already complete)
  handleSync: function () {
    if (GemiBoost.Sync && GemiBoost.Sync.isCurrentlySyncing()) {
      GemiBoost.Sync.abortSync();
      this.updateCatalog();
      return;
    }

    const startFullSync = () => {
      this.cachedChatData = null;
      this.lastSignature = '';
      this.lastQueryCount = 0;

      GemiBoost.Sync.triggerSync({
        onBatchLoaded: () => {
          this.updateCatalog();
        },
        onComplete: (fullItems) => {
          const chatId = GemiBoost.Utils.getChatId();
          if (chatId && fullItems && fullItems.length > 0 && GemiBoost.Storage) {
            GemiBoost.Storage.saveChatCache(chatId, fullItems, true);
          }
          this.cachedChatData = {
            version: GemiBoost.Config ? GemiBoost.Config.CACHE_VERSION : 4,
            items: fullItems,
            isFullySynced: true,
            updatedAt: Date.now()
          };
          this.updateCatalog();
        },
        onAborted: () => {
          this.updateCatalog();
        }
      });
    };

    const evaluateSync = (cachedData) => {
      if (GemiBoost.Sync && GemiBoost.Sync.checkAlreadySynced) {
        const check = GemiBoost.Sync.checkAlreadySynced(cachedData);
        if (check.canSkip) {
          this.lastSignature = '';
          this.lastQueryCount = 0;
          this.updateCatalog();

          const domItems = GemiBoost.Extractor ? GemiBoost.Extractor.extractFromDOM() : [];
          const chatId = GemiBoost.Utils.getChatId();
          const finalTurnCount = domItems.filter((it) => it.isTurnRoot !== false).length;

          if (check.markSynced && chatId && domItems.length > 0) {
            this.cachedChatData = {
              version: GemiBoost.Config ? GemiBoost.Config.CACHE_VERSION : 4,
              items: domItems,
              isFullySynced: true,
              updatedAt: Date.now()
            };
            if (GemiBoost.Storage) {
              GemiBoost.Storage.saveChatCache(chatId, domItems, true);
            }
          }

          if (GemiBoost.UI && GemiBoost.UI.setSyncButtonState) {
            GemiBoost.UI.setSyncButtonState('synced', `已完整同步全部 ${finalTurnCount} 条历史提问`);
            if (GemiBoost.UI.scheduleButtonReset) {
              GemiBoost.UI.scheduleButtonReset('sync', GemiBoost.Config.TIMING.SYNC_ICON_FEEDBACK_MS);
            }
          }
          return;
        }
      }
      startFullSync();
    };

    if (this.cachedChatData) {
      evaluateSync(this.cachedChatData);
      return;
    }

    const chatId = GemiBoost.Utils.getChatId();
    if (chatId && GemiBoost.Storage && GemiBoost.Storage.loadChatCache) {
      GemiBoost.Storage.loadChatCache(chatId, (cached) => {
        if (GemiBoost.Utils.getChatId() !== chatId) return;
        evaluateSync(cached || null);
      });
    } else {
      evaluateSync(null);
    }
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

    let savedInThisPass = false;
    if (mergeResult.isCorrupted) {
      this.cachedChatData = null;
    } else if (mergeResult.hasChanges && this.cachedChatData) {
      this.cachedChatData.items = mergeResult.updatedList;
      const chatId = GemiBoost.Utils.getChatId();
      if (chatId) {
        GemiBoost.Storage.saveChatCache(chatId, mergeResult.updatedList, true);
        savedInThisPass = true;
      }
    }

    const finalItems = mergeResult.items;

    // Synchronize canonical queryIndex back onto live DOM nodes monotonically to handle repeated/empty prompts
    const livePrompts = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
    const turnRoots = finalItems.filter((it) => it.isTurnRoot !== false);
    if (livePrompts.length > 0 && turnRoots.length > 0) {
      let rootCursor = 0;
      const nonEmptyIndices = [];
      for (let pi = 0; pi < livePrompts.length; pi++) {
        const promptEl = livePrompts[pi];
        const text = GemiBoost.Utils ? GemiBoost.Utils.getCleanPromptText(promptEl) : '';
        if (text) {
          let matchIdx = -1;
          for (let ri = rootCursor; ri < turnRoots.length; ri++) {
            if (turnRoots[ri].rawText === text) {
              matchIdx = ri;
              break;
            }
          }
          if (matchIdx !== -1) {
            const match = turnRoots[matchIdx];
            if (typeof match.queryIndex === 'number') {
              promptEl.dataset.gbQueryIndex = String(match.queryIndex);
            }
            rootCursor = matchIdx + 1;
            nonEmptyIndices.push({ domPos: pi, rootPos: matchIdx });
          }
        }
      }
      // Stamp empty-text (attachment-only) live prompts adjacent to anchored turns
      if (nonEmptyIndices.length > 0) {
        const firstAnchor = nonEmptyIndices[0];
        for (let offset = 1; offset <= firstAnchor.domPos; offset++) {
          const domPos = firstAnchor.domPos - offset;
          const rootPos = firstAnchor.rootPos - offset;
          if (rootPos >= 0 && turnRoots[rootPos] && !turnRoots[rootPos].rawText && typeof turnRoots[rootPos].queryIndex === 'number') {
            livePrompts[domPos].dataset.gbQueryIndex = String(turnRoots[rootPos].queryIndex);
          }
        }
        const lastAnchor = nonEmptyIndices[nonEmptyIndices.length - 1];
        for (let domPos = lastAnchor.domPos + 1; domPos < livePrompts.length; domPos++) {
          const rootPos = lastAnchor.rootPos + (domPos - lastAnchor.domPos);
          if (rootPos < turnRoots.length && turnRoots[rootPos] && !turnRoots[rootPos].rawText && typeof turnRoots[rootPos].queryIndex === 'number') {
            livePrompts[domPos].dataset.gbQueryIndex = String(turnRoots[rootPos].queryIndex);
          }
        }
      } else if (turnRoots.length === livePrompts.length) {
        livePrompts.forEach((promptEl, pi) => {
          if (typeof turnRoots[pi].queryIndex === 'number') {
            promptEl.dataset.gbQueryIndex = String(turnRoots[pi].queryIndex);
          }
        });
      }
    }

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

    // Persist cache updates only once per pass if this chat was already fully synced
    const chatId = GemiBoost.Utils.getChatId();
    if (!savedInThisPass && chatId && this.cachedChatData?.isFullySynced && !GemiBoost.Sync.isCurrentlySyncing()) {
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

    const debouncedCheckNotification = GemiBoost.Utils.debounce(() => {
      if (GemiBoost.Notification) {
        GemiBoost.Notification.checkGenerationState();
      }
    }, 150);

    const observer = new MutationObserver((mutations) => {
      // 1. Detect SPA route navigation
      if (this.currentUrl !== location.href) {
        this.currentUrl = location.href;

        if (this._metadataUpdateTimer) {
          clearTimeout(this._metadataUpdateTimer);
          this._metadataUpdateTimer = null;
        }

        // Reset notification state so navigation doesn't trigger false alerts
        if (GemiBoost.Notification) {
          GemiBoost.Notification.resetState();
        }

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
            if (GemiBoost.Utils.getChatId() !== newChatId) return;
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

      // 3. Trigger debounced update if nodes were added or removed, and check generation state
      let shouldUpdate = false;
      let shouldCheckNotification = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          shouldUpdate = true;
          shouldCheckNotification = true;
          break;
        }
        if (mutation.type === 'attributes') {
          shouldCheckNotification = true;
        }
      }
      if (shouldUpdate) {
        debouncedUpdate();
      }
      if (shouldCheckNotification) {
        debouncedCheckNotification();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-testid', 'data-test-id']
    });
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
