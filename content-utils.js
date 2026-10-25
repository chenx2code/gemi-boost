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

  // Promise-based sleep delay
  sleep: function (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  // Strip leading slash command or skill identifier (e.g. "/multi-subagent-search ")
  stripSlashCommand: function (text) {
    if (!text) return '';
    return text.replace(/^\/[a-zA-Z0-9_\-\.]+\s*/, '').trim();
  }
};

// Global alias for backwards compatibility
window.Utils = GemiBoost.Utils;
