// content-sync.js
// Handles full history loading and cancellation for long conversations

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Sync = {
  isSyncing: false,
  abortController: null,
  activeChatId: null,
  activeSilentUI: false,
  _activeSyncPromise: null,
  _resolveActiveSync: null,

  // Check if history synchronization is currently active
  isCurrentlySyncing: function () {
    return this.isSyncing;
  },

  // Wait for an ongoing sync loop to complete or abort (returns { status, items })
  waitForActiveSync: function () {
    if (!this.isSyncing || !this._activeSyncPromise) {
      return Promise.resolve({ status: 'idle', items: null });
    }
    return this._activeSyncPromise;
  },

  // Check whether any loading indicator or spinner is visible near the top of the scroller
  hasTopLoadingIndicator: function (scroller) {
    if (!scroller || typeof scroller.querySelectorAll !== 'function') return false;
    const selector = GemiBoost.Config?.TIMING?.SYNC_SPINNER_SELECTOR || '[role="progressbar"], mat-progress-spinner, mat-spinner';
    const candidates = scroller.querySelectorAll(selector);
    if (!candidates || candidates.length === 0) return false;

    const scrollerTop = typeof scroller.getBoundingClientRect === 'function'
      ? scroller.getBoundingClientRect().top
      : 0;
    const firstQuery = document.querySelector(GemiBoost.Config.SELECTORS.USER_QUERY);
    const firstQueryTop = firstQuery && typeof firstQuery.getBoundingClientRect === 'function'
      ? firstQuery.getBoundingClientRect().top
      : scrollerTop + 220;

    for (const el of candidates) {
      if (typeof el.getBoundingClientRect !== 'function') return true;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) continue;
      if (rect.top <= Math.max(scrollerTop + 220, firstQueryTop + 10)) {
        return true;
      }
    }
    return false;
  },

  // Determine whether live DOM already holds all turns and full-history scroll sync can be skipped
  checkAlreadySynced: function (cachedData) {
    const chatId = GemiBoost.Utils.getChatId();
    const scroller = GemiBoost.Utils.getChatScrollContainer();
    if (!scroller || !chatId) {
      return { canSkip: false, reason: 'missing-context', domTurnCount: 0, markSynced: false };
    }

    const domQueries = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY);
    const domTurnCount = domQueries.length;

    const rpc = GemiBoost.Extractor && GemiBoost.Extractor.getRpcActivity ? GemiBoost.Extractor.getRpcActivity() : null;
    if (rpc && rpc.inFlightCount > 0) {
      return { canSkip: false, reason: 'rpc-active', domTurnCount, markSynced: false };
    }

    if (this.hasTopLoadingIndicator(scroller)) {
      return { canSkip: false, reason: 'spinner-active', domTurnCount, markSynced: false };
    }

    const cachedTurnRoots = cachedData && cachedData.isFullySynced && Array.isArray(cachedData.items)
      ? cachedData.items.filter((it) => it.isTurnRoot !== false)
      : [];
    const cachedTurnCount = cachedTurnRoots.length;

    // 1. Short chat with no scroll overflow
    if (scroller.scrollHeight <= scroller.clientHeight + 50) {
      if (cachedTurnCount === 0 || domTurnCount >= cachedTurnCount) {
        return { canSkip: true, reason: 'no-overflow', domTurnCount, markSynced: domTurnCount > 0 };
      }
    }

    // 2. Overflowing chat backed by verified isFullySynced cache (matching Turn #1 identity + turn count)
    if (cachedTurnCount > 0 && domTurnCount >= cachedTurnCount) {
      const firstDomQuery = domQueries[0];
      const firstDomText = GemiBoost.Utils.getCleanPromptText(firstDomQuery);
      const firstCached = cachedTurnRoots[0];

      let topMatches = false;
      if (firstCached.rawText) {
        topMatches = firstDomText === firstCached.rawText;
      } else {
        // Pure-attachment Turn #1: verify DOM turn has no text and contains attachment nodes
        let hasMedia = false;
        const extractor = GemiBoost.Extractor;
        if (extractor && (typeof extractor.getValidImages === 'function' || typeof extractor.getFileAndQuoteElements === 'function')) {
          const hasImages = typeof extractor.getValidImages === 'function' && extractor.getValidImages(firstDomQuery).length > 0;
          const hasFiles = !hasImages &&
            typeof extractor.getFileAndQuoteElements === 'function' &&
            extractor.getFileAndQuoteElements(firstDomQuery).length > 0;
          hasMedia = hasImages || hasFiles;
        } else if (firstDomQuery.querySelector) {
          const selectors = [
            'img',
            GemiBoost.Config?.SELECTORS?.FILE_CONTAINER,
            GemiBoost.Config?.SELECTORS?.FILE_CARD,
            GemiBoost.Config?.SELECTORS?.QUOTE_CONTAINER
          ].filter(Boolean);
          hasMedia = Boolean(firstDomQuery.querySelector(selectors.join(', ')));
        }
        topMatches = !firstDomText && hasMedia;
      }

      if (topMatches) {
        return { canSkip: true, reason: 'cache-verified', domTurnCount, markSynced: true };
      }
    }

    return { canSkip: false, reason: 'needs-sync', domTurnCount, markSynced: false };
  },

  // Immediately abort any ongoing sync loop (e.g. on route change or cancel click)
  abortSync: function () {
    if (this.isSyncing && this.abortController) {
      this.abortController.abort();
    }
    this.isSyncing = false;
    this.abortController = null;
    this.activeChatId = null;

    if (this._resolveActiveSync) {
      this._resolveActiveSync({ status: 'aborted', items: null });
      this._resolveActiveSync = null;
      this._activeSyncPromise = null;
    }

    if (!this.activeSilentUI && GemiBoost.UI) {
      GemiBoost.UI.setSyncButtonState('idle');
    }
    this.activeSilentUI = false;
  },

  // Start the adaptive scroll-up sync loop to fetch all virtualized history
  triggerSync: async function (callbacks = {}) {
    const { onBatchLoaded, onComplete, onAborted, silentUI = false, restoreScrollAnchor = null } = callbacks;

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
    this._activeSyncPromise = new Promise((resolve) => {
      this._resolveActiveSync = resolve;
    });

    // Reset persistent cache for this chat before force-sync
    GemiBoost.Storage.clearChatCache(chatId);

    if (!silentUI && GemiBoost.UI) {
      GemiBoost.UI.setSyncButtonState('syncing', '正在加载全部历史记录... (再次点击可取消)');
    }

    let initialQueries = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY);
    let prevCount = initialQueries.length;
    let prevFirstEl = initialQueries[0] || null;
    let prevFirstSig = GemiBoost.Utils.getFirstQuerySignature
      ? GemiBoost.Utils.getFirstQuerySignature(prevFirstEl)
      : GemiBoost.Utils.getFirstQueryText();
    let batchesLoaded = 0;
    let sawActiveLoadSignal = false;
    let lastActivityTime = Date.now();
    let isCheckingEarlierNotified = false;
    let quietProbeCount = 0;

    // Wake up the sleep loop immediately upon DOM batch arrival, RPC completion, or abort
    let wakeWaiter = null;
    const notifyWake = () => {
      if (wakeWaiter) {
        const fn = wakeWaiter;
        wakeWaiter = null;
        fn();
      }
    };

    const waitNextPulse = (delayMs) => {
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (timer !== null) clearTimeout(timer);
          if (wakeWaiter === finish) wakeWaiter = null;
          signal.removeEventListener('abort', finish);
          resolve();
        };
        wakeWaiter = finish;
        signal.addEventListener('abort', finish, { once: true });
        timer = setTimeout(finish, delayMs);
      });
    };

    const unsubRpc = GemiBoost.Extractor && GemiBoost.Extractor.onRpcActivityChange
      ? GemiBoost.Extractor.onRpcActivityChange((rpcState) => {
          if (signal.aborted) return;
          if (rpcState.inFlightCount > 0) {
            sawActiveLoadSignal = true;
            lastActivityTime = Date.now();
            quietProbeCount = 0;
          } else {
            lastActivityTime = Date.now();
            notifyWake();
          }
        })
      : () => {};

    // Continuous MutationObserver to detect newly prepended user queries
    const obs = new MutationObserver(() => {
      if (signal.aborted) {
        obs.disconnect();
        return;
      }

      const currQueries = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY);
      const currCount = currQueries.length;
      const currFirstEl = currQueries[0] || null;
      const currFirstSig = GemiBoost.Utils.getFirstQuerySignature
        ? GemiBoost.Utils.getFirstQuerySignature(currFirstEl)
        : GemiBoost.Utils.getFirstQueryText();

      // Only genuine new user queries / changed first query count as history loading progress
      if (currCount > prevCount || currFirstEl !== prevFirstEl || (currFirstSig && currFirstSig !== prevFirstSig)) {
        batchesLoaded++;
        quietProbeCount = 0;
        lastActivityTime = Date.now();
        isCheckingEarlierNotified = false;
        prevCount = currCount;
        prevFirstEl = currFirstEl;
        prevFirstSig = currFirstSig;

        if (onBatchLoaded) onBatchLoaded(currCount);

        if (currFirstEl) {
          currFirstEl.scrollIntoView({ block: 'start' });
        }

        if (!silentUI && GemiBoost.UI) {
          GemiBoost.UI.setSyncButtonState('syncing', `正在同步... (已加载 ${currCount} 条，点击可停止)`);
        }
        notifyWake();
      }
    });

    obs.observe(scroller, { childList: true, subtree: true });

    const timing = GemiBoost.Config.TIMING;
    const maxDurationMs = timing.SYNC_MAX_DURATION_MS || 120000;
    const basePulseMs = timing.SYNC_PULSE_INTERVAL_MS || 120;
    const maxPulseMs = timing.SYNC_PULSE_MAX_INTERVAL_MS || 350;
    const quietInitialMs = timing.SYNC_QUIET_INITIAL_TIMEOUT_MS || 650;
    const quietAfterBatchMs = timing.SYNC_QUIET_AFTER_BATCH_MS || 900;
    const startTime = Date.now();

    try {
      while (!signal.aborted && Date.now() - startTime < maxDurationMs) {
        // 1. Keep view pinned to the earliest loaded prompt and probe top scroll boundary across frames
        const firstQuery = document.querySelector(GemiBoost.Config.SELECTORS.USER_QUERY);
        if (firstQuery) {
          firstQuery.scrollIntoView({ block: 'start' });
        }

        if (scroller.scrollTop > 0) {
          scroller.scrollTop = 0;
        } else if (scroller.scrollHeight > scroller.clientHeight) {
          scroller.scrollTop = 24;
          const nudgeTop = () => {
            if (!signal.aborted && this.isSyncing) {
              scroller.scrollTop = 0;
            }
          };
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(nudgeTop);
          } else {
            scroller.scrollTop = 0;
          }
        }

        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        if (typeof WheelEvent === 'function') {
          scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));
        }

        // 2. Inspect live RPC & DOM loading indicators so slow requests never abort prematurely
        const rpcState = GemiBoost.Extractor && GemiBoost.Extractor.getRpcActivity ? GemiBoost.Extractor.getRpcActivity() : null;
        const rpcActive = Boolean(rpcState && rpcState.inFlightCount > 0);
        const spinnerActive = this.hasTopLoadingIndicator(scroller);

        if (rpcActive || spinnerActive) {
          sawActiveLoadSignal = true;
          lastActivityTime = Date.now();
          quietProbeCount = 0;
        } else {
          quietProbeCount++;
        }

        const elapsedSinceActivity = Date.now() - lastActivityTime;

        if (!silentUI && elapsedSinceActivity > 400 && !isCheckingEarlierNotified && GemiBoost.UI) {
          isCheckingEarlierNotified = true;
          GemiBoost.UI.setSyncButtonState('syncing', `正在同步... (已加载 ${prevCount} 条，正在确认顶部...)`);
        }

        // 3. Adaptive early exit once RPC & DOM settle quietly
        const quietThresholdMs = (batchesLoaded > 0 || sawActiveLoadSignal) ? quietAfterBatchMs : quietInitialMs;
        if (!rpcActive && !spinnerActive && elapsedSinceActivity >= quietThresholdMs) {
          break;
        }

        const adaptiveDelayMs = quietProbeCount <= 2
          ? basePulseMs
          : Math.min(maxPulseMs, basePulseMs + quietProbeCount * 50);
        await waitNextPulse(adaptiveDelayMs);
      }
    } finally {
      unsubRpc();
      obs.disconnect();
      wakeWaiter = null;
      this.isSyncing = false;
      this.abortController = null;
      this.activeChatId = null;
      this.activeSilentUI = false;
    }

    if (signal.aborted) {
      if (this._resolveActiveSync) {
        this._resolveActiveSync({ status: 'aborted', items: null });
        this._resolveActiveSync = null;
        this._activeSyncPromise = null;
      }
      if (onAborted) onAborted();
      return;
    }

    // Restore reading anchor on background export sync, or scroll smoothly to Turn #1 on manual refresh
    if (restoreScrollAnchor) {
      GemiBoost.Utils.restoreScrollAnchor(scroller, restoreScrollAnchor);
    } else {
      const finalFirstQuery = document.querySelector(GemiBoost.Config.SELECTORS.USER_QUERY);
      if (finalFirstQuery) {
        finalFirstQuery.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        scroller.scrollTop = 0;
      }
    }

    // Extract complete list directly from live DOM in top-to-bottom order
    const fullDomItems = GemiBoost.Extractor.extractFromDOM();
    const finalTurnCount = fullDomItems.filter((it) => it.isTurnRoot !== false).length;

    if (!silentUI && GemiBoost.UI) {
      GemiBoost.UI.setSyncButtonState('synced', `已完整同步全部 ${finalTurnCount} 条历史提问`);
      if (GemiBoost.UI.scheduleButtonReset) {
        GemiBoost.UI.scheduleButtonReset('sync', GemiBoost.Config.TIMING.SYNC_ICON_FEEDBACK_MS);
      } else {
        setTimeout(() => {
          GemiBoost.UI.setSyncButtonState('idle');
        }, GemiBoost.Config.TIMING.SYNC_ICON_FEEDBACK_MS);
      }
    }

    if (this._resolveActiveSync) {
      this._resolveActiveSync({ status: 'completed', items: fullDomItems });
      this._resolveActiveSync = null;
      this._activeSyncPromise = null;
    }

    if (onComplete) {
      onComplete(fullDomItems);
    }
  }
};
