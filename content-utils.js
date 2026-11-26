// content-utils.js
// Utility functions for GemiBoost

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Utils = {
  // Debounce function to limit execution frequency
  debounce: function (func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  },

  // Promise-based sleep delay with optional AbortSignal cancellation
  sleep: function (ms, signal) {
    if (signal && signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let timer = null;
      const onAbort = () => {
        if (timer !== null) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      };
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      timer = setTimeout(() => {
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      }, ms);
    });
  },

  // Extract chat ID from current URL pathname (/app/<chatId>)
  getChatId: function (pathname = location.pathname) {
    const match = pathname.match(/\/app\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  },

  // Check if current page is an active chat conversation page
  isChatPage: function () {
    return location.pathname.startsWith('/app/') && location.pathname.length > 5;
  },

  // Detect the scrollable container for the chat history
  getChatScrollContainer: function () {
    const userQuerySelector = GemiBoost.Config.SELECTORS.USER_QUERY;
    const uq = document.querySelector(userQuerySelector);

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

    for (const selector of GemiBoost.Config.SELECTORS.CHAT_SCROLLER) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    return document.documentElement;
  },

  // Retrieve text from the earliest rendered user query for signature comparisons
  getFirstQueryText: function () {
    const first = document.querySelector(GemiBoost.Config.SELECTORS.USER_QUERY);
    if (!first) return '';
    const textNode = first.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || first;
    return textNode.textContent.trim().slice(0, 40);
  },

  // Extract and clean raw prompt text from a query DOM node, stripping hidden screen reader labels
  getCleanPromptText: function (queryEl) {
    if (!queryEl) return '';
    const textNode = queryEl.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || queryEl;
    let text = textNode.textContent ? textNode.textContent.trim() : '';
    const hiddenLabel = queryEl.querySelector(GemiBoost.Config.SELECTORS.HIDDEN_LABEL);
    if (hiddenLabel && hiddenLabel.textContent) {
      const hiddenText = hiddenLabel.textContent.trim();
      if (text.startsWith(hiddenText)) {
        text = text.substring(hiddenText.length).trim();
      }
    }
    return text;
  },

  // Retrieve full text + attachment count from earliest query to avoid 40-char truncation collisions
  getFirstQuerySignature: function (firstEl) {
    const first = firstEl || document.querySelector(GemiBoost.Config.SELECTORS.USER_QUERY);
    if (!first) return '';
    const cleanText = this.getCleanPromptText(first);
    const attCount = first.querySelectorAll
      ? first.querySelectorAll('img, .file-preview-container, [class*="file-preview"], [class*="submitted-quote"]').length
      : 0;
    return `${cleanText}|${attCount}`;
  },

  // Capture current scroll anchor element so reading position can be restored after prepended hydration
  captureScrollAnchor: function (scroller) {
    if (!scroller) return null;
    const initialScrollTop = scroller.scrollTop || 0;
    let anchorEl = null;
    let offsetFromTop = 0;

    if (typeof scroller.getBoundingClientRect === 'function' && typeof document !== 'undefined') {
      const scrollerRect = scroller.getBoundingClientRect();
      const queries = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY);
      for (const q of queries) {
        if (typeof q.getBoundingClientRect !== 'function') continue;
        const rect = q.getBoundingClientRect();
        if (rect.bottom >= scrollerRect.top - 20) {
          anchorEl = q;
          offsetFromTop = rect.top - scrollerRect.top;
          break;
        }
      }
    }

    return {
      scrollTop: initialScrollTop,
      anchorEl,
      offsetFromTop
    };
  },

  // Restore scroll position accurately relative to captured anchor element (fallback to raw scrollTop)
  restoreScrollAnchor: function (scroller, anchor) {
    if (!scroller || !anchor) return;
    if (
      anchor.anchorEl &&
      anchor.anchorEl.isConnected &&
      typeof anchor.anchorEl.getBoundingClientRect === 'function' &&
      typeof scroller.getBoundingClientRect === 'function'
    ) {
      const scrollerRect = scroller.getBoundingClientRect();
      const rect = anchor.anchorEl.getBoundingClientRect();
      const delta = (rect.top - scrollerRect.top) - anchor.offsetFromTop;
      if (Math.abs(delta) > 1) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
      }
      return;
    }
    scroller.scrollTop = Math.max(0, anchor.scrollTop || 0);
  },

  // Strip leading slash command or skill identifier (e.g. "/multi-subagent-search ")
  stripSlashCommand: function (text) {
    if (!text) return '';
    return text.replace(/^\/[a-zA-Z0-9_\-\.]+\s*/, '').trim();
  }
};

// Global alias for backwards compatibility
window.Utils = GemiBoost.Utils;
