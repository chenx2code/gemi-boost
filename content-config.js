// content-config.js
// Centralized configuration and DOM selector registry for GemiBoost

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Config = {
  // DOM element IDs
  DOM_IDS: {
    CONTAINER: 'gemiboost-toc-container',
    INNER: 'gemiboost-toc-inner',
    LIST: 'gemiboost-toc-list',
    TOGGLE_BTN: 'gemiboost-toc-toggle',
    SYNC_BTN: 'gemiboost-toc-sync-btn',
    EXPORT_BTN: 'gemiboost-toc-export-btn',
    EXPORT_FOOTER_BTN: 'gemiboost-toc-export-footer-btn'
  },

  // DOM selectors for Gemini Web UI
  SELECTORS: {
    MAIN_CONTAINER: 'bard-sidenav-container',
    CHAT_SCROLLER: [
      'infinite-scroller[data-test-id="chat-history-container"]',
      'infinite-scroller.chat-history'
    ],
    USER_QUERY: 'user-query',
    QUERY_TEXT: '.query-text, p.query-text-line, .query-content',
    HIDDEN_LABEL: '.cdk-visually-hidden, [class*="visually-hidden"]',
    FILE_CONTAINER: '.file-preview-container, [class*="file-preview"]',
    MODEL_RESPONSE: 'model-response',
    MESSAGE_CONTENT: 'message-content, .model-response-text, .markdown',
    THINKING_CONTAINER: 'thinking-process, [data-test-id="thinking-process"], details.thinking-process, .thinking-content',
    CODE_BLOCK: 'code-block, pre:has(code)',
    CODE_CONTAINER: '.code-container, pre',
    CODE_DECORATION: '.code-block-decoration',
    CODE_LANG: '.code-block-decoration span, [class*="language-"]',
    MATH_TEX_ANNOTATION: 'annotation[encoding="application/x-tex"]',
    MATH_DISPLAY: '.katex-display',
    MATH_INLINE: '.katex:not(.katex-display *)',
    CHAT_TITLE: 'h1.conversation-title, .conversation-title, [data-test-id="conversation-title"]',
    TOP_BAR_ACTIONS: [
      'top-bar-actions .buttons-container',
      'top-bar-actions .top-bar-actions',
      'top-bar-actions'
    ],
    TOP_BAR_CONTAINERS: [
      'top-bar-actions',
      'header',
      '[role="banner"]'
    ],
    CHAT_SCROLLER_EXCLUDE: 'infinite-scroller, user-query, model-response, [class*="mini-app"], .chat-history'
  },

  // Timing constants (milliseconds)
  TIMING: {
    DEBOUNCE_DOM_OBSERVER_MS: 1000,
    SYNC_PULSE_INTERVAL_MS: 250,
    SYNC_INACTIVITY_TIMEOUT_MS: 4000,
    SYNC_MAX_DURATION_MS: 120000,
    NAVIGATE_SCROLL_RETRY_MS: 200,
    NAVIGATE_SCROLL_MAX_ATTEMPTS: 10,
    MOUNT_BUTTON_RETRY_MS: 200,
    MOUNT_BUTTON_MAX_ATTEMPTS: 15,
    SYNC_ICON_FEEDBACK_MS: 1200,
    EXPORT_FEEDBACK_MS: 1500
  },

  // Cache schema version for invalidating stale formats
  CACHE_VERSION: 2
};
