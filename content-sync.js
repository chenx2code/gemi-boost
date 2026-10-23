// content-sync.js
// Handles full history loading and cancellation for long conversations

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Sync = {
  isSyncing: false,
  abortController: null,
  activeChatId: null,

  // Check if history synchronization is currently active
  isCurrentlySyncing: function () {
    return this.isSyncing;
  },

  // Immediately abort any ongoing sync loop (e.g. on route change or cancel click)
  abortSync: function () {
    if (this.isSyncing && this.abortController) {
      this.abortController.abort();
    }
    this.isSyncing = false;
    this.abortController = null;
    this.activeChatId = null;

    if (!this.activeSilentUI && GemiBoost.UI) {
      GemiBoost.UI.setSyncButtonState('idle');
    }
    this.activeSilentUI = false;
  },

  // Start the automated scroll-up sync loop to fetch all virtualized history
  triggerSync: async function (callbacks = {}) {
    const { onBatchLoaded, onComplete, onAborted, silentUI = false } = callbacks;

    if (this.isSyncing) {
      // Toggle behavior: clicking while syncing cancels the ongoing loop
      this.abortSync();
      if (onAborted) onAborted();
      return;
    }

    const chatId = GemiBoost.Utils.getChatId();
    const scroller = GemiBoost.Utils.getChatScrollContainer();
    if (!scroller || !chatId) return;

    this.isSyncing = true;
    this.activeChatId = chatId;
    this.activeSilentUI = !!silentUI;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Reset persistent cache for this chat before force-sync
    GemiBoost.Storage.clearChatCache(chatId);

    if (!silentUI && GemiBoost.UI) {
      GemiBoost.UI.setSyncButtonState('syncing', '正在加载全部历史记录... (再次点击可取消)');
    }

    let prevCount = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY).length;
    let prevFirstSig = GemiBoost.Utils.getFirstQueryText();
    let prevScrollHeight = scroller.scrollHeight;
    let lastActivityTime = Date.now();
    let isCheckingEarlierNotified = false;

    // Continuous MutationObserver to detect newly prepended batches
    const obs = new MutationObserver(() => {
      if (signal.aborted) {
        obs.disconnect();
        return;
      }

      const currCount = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY).length;
      const currFirstSig = GemiBoost.Utils.getFirstQueryText();

      // Only genuine query changes count as activity
      if (currCount > prevCount || (currFirstSig && currFirstSig !== prevFirstSig)) {
        lastActivityTime = Date.now();
        isCheckingEarlierNotified = false;
        prevCount = currCount;
        prevFirstSig = currFirstSig;

        if (onBatchLoaded) onBatchLoaded(currCount);

        // Pin viewport to the newly arrived earliest prompt
        const newFirst = document.querySelector(GemiBoost.Config.SELECTORS.USER_QUERY);
        if (newFirst) {
          newFirst.scrollIntoView({ block: 'start' });
        }

        if (!silentUI && GemiBoost.UI) {
          GemiBoost.UI.setSyncButtonState('syncing', `正在同步... (已加载 ${currCount} 条，点击可停止)`);
        }
      }
    });

    obs.observe(scroller, { childList: true, subtree: true });

    const maxDurationMs = GemiBoost.Config.TIMING.SYNC_MAX_DURATION_MS;
    const inactivityTimeoutMs = GemiBoost.Config.TIMING.SYNC_INACTIVITY_TIMEOUT_MS;
    const pulseIntervalMs = GemiBoost.Config.TIMING.SYNC_PULSE_INTERVAL_MS;
    const startTime = Date.now();

    try {
      while (!signal.aborted && Date.now() - startTime < maxDurationMs) {
        // 1. Keep view pinned to the earliest loaded prompt
        const firstQuery = document.querySelector(GemiBoost.Config.SELECTORS.USER_QUERY);
        if (firstQuery) {
          firstQuery.scrollIntoView({ block: 'start' });
        }

        // 2. Continuously nudge scroll to top to maintain top-boundary trigger on Gemini scroller
        if (scroller.scrollTop > 0) {
          scroller.scrollTop = 0;
        } else {
          scroller.scrollTop = 25;
          scroller.scrollTop = 0;
        }

        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));

        // Detect if content height expanded
        const currentScrollHeight = scroller.scrollHeight;
        if (currentScrollHeight > prevScrollHeight + 10) {
          prevScrollHeight = currentScrollHeight;
          lastActivityTime = Date.now();
          isCheckingEarlierNotified = false;
        }

        const elapsedSinceActivity = Date.now() - lastActivityTime;
        if (!silentUI && elapsedSinceActivity > 1500 && !isCheckingEarlierNotified && GemiBoost.UI) {
          isCheckingEarlierNotified = true;
          GemiBoost.UI.setSyncButtonState('syncing', `正在同步... (已加载 ${prevCount} 条，正在检查更早的历史...)`);
        }

        // Check if no new prompts or height changes have occurred past inactivity threshold
        if (elapsedSinceActivity > inactivityTimeoutMs) {
          break;
        }

        await GemiBoost.Utils.sleep(pulseIntervalMs);
      }
    } finally {
      obs.disconnect();
      this.isSyncing = false;
      this.abortController = null;
      this.activeChatId = null;
      this.activeSilentUI = false;
    }

    if (signal.aborted) {
      if (onAborted) onAborted();
      return;
    }

    // Align viewport to the first prompt
    const finalFirstQuery = document.querySelector(GemiBoost.Config.SELECTORS.USER_QUERY);
    if (finalFirstQuery) {
      finalFirstQuery.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      scroller.scrollTop = 0;
    }

    // Extract complete list directly from live DOM in top-to-bottom order
    const fullDomItems = GemiBoost.Extractor.extractFromDOM();
    if (chatId && fullDomItems && fullDomItems.length > 0) {
      GemiBoost.Storage.saveChatCache(chatId, fullDomItems, true);
    }

    if (!silentUI && GemiBoost.UI) {
      GemiBoost.UI.setSyncButtonState('synced', `已完整同步全部 ${prevCount} 条历史提问`);
      setTimeout(() => {
        GemiBoost.UI.setSyncButtonState('idle');
      }, GemiBoost.Config.TIMING.SYNC_ICON_FEEDBACK_MS);
    }

    if (onComplete) {
      onComplete(fullDomItems);
    }
  }
};
