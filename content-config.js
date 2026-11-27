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
    OBSIDIAN_BTN: 'gemiboost-toc-obsidian-btn'
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
    FILE_CARD: '[data-test-id="uploaded-file"], .new-file-preview-container',
    EXPLICIT_QUOTE_CARD: '.submitted-quote-container, .submitted-quote-in-query, .quote-preview-container, .citation-preview',
    FILE_CONTAINER: '.file-preview-container, [class*="file-preview"], [data-test-id*="file-preview"], [data-test-id="uploaded-file"]',
    QUOTE_CONTAINER: [
      '.submitted-quote-container',
      '.submitted-quote-in-query',
      '[class*="submitted-quote"]',
      'blockquote.submitted-quote-container',
      'blockquote[aria-label*="quote" i]',
      'blockquote',
      'gem-icon.submitted-quote-icon',
      '.quote-preview-container',
      '[class*="quote-preview"]',
      '.citation-preview',
      '[class*="citation-preview"]',
      '[class*="quote"]',
      '[class*="citation"]',
      '[data-test-id*="quote"]',
      '[data-test-id*="citation"]',
      '[aria-label*="quote" i]',
      '[aria-label*="citation" i]',
      '[aria-label*="quoted" i]',
      '[aria-label*="引用" i]'
    ].join(', '),
    MODEL_RESPONSE: 'model-response',
    MESSAGE_CONTENT: 'message-content, .model-response-text, .markdown',
    THINKING_CONTAINER: [
      'spark-thinking-steps',
      '.spark-thinking-container',
      '.thinking-header',
      'thinking-process',
      'thinking-steps',
      '[class*="spark-thinking"]',
      '[class*="thinking-container"]',
      '[class*="thought-container"]',
      '[class*="thinking-process"]',
      '.thinking-content',
      '.thought-content',
      '[data-test-id*="thinking"]',
      '[data-test-id*="thought"]',
      'details.thinking-process',
      'details.thought-container',
      'details[class*="thinking"]',
      'details[class*="thought"]'
    ].join(', '),
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
    CHAT_SCROLLER_EXCLUDE: 'infinite-scroller, user-query, model-response, [class*="mini-app"], .chat-history',
    STOP_BUTTON: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="停止" i]',
      'button[aria-label*="応答を停止" i]',
      'button[data-testid*="stop" i]',
      'button[data-test-id*="stop" i]',
      'button.stop-button',
      'button.stop-generating-button',
      'mat-icon[data-mat-icon-name*="stop" i]',
      'mat-icon[fonticon*="stop" i]'
    ].join(', ')
  },

  // Timing constants (milliseconds)
  TIMING: {
    DEBOUNCE_DOM_OBSERVER_MS: 1000,
    SYNC_PULSE_INTERVAL_MS: 120,
    SYNC_PULSE_MAX_INTERVAL_MS: 350,
    SYNC_QUIET_INITIAL_TIMEOUT_MS: 650,
    SYNC_QUIET_AFTER_BATCH_MS: 900,
    SYNC_INACTIVITY_TIMEOUT_MS: 4500,
    SYNC_MAX_DURATION_MS: 120000,
    SYNC_SPINNER_SELECTOR: '[role="progressbar"], mat-progress-spinner, mat-spinner, [aria-busy="true"]',
    NAVIGATE_SCROLL_RETRY_MS: 200,
    NAVIGATE_SCROLL_MAX_ATTEMPTS: 10,
    MOUNT_BUTTON_RETRY_MS: 200,
    MOUNT_BUTTON_MAX_ATTEMPTS: 15,
    SYNC_ICON_FEEDBACK_MS: 900,
    EXPORT_FEEDBACK_MS: 1200
  },

  // Cache schema version for invalidating stale formats
  CACHE_VERSION: 5,

  // User configurable preferences and storage keys
  SETTINGS: {
    STORAGE_KEY: 'gemiboost_export_settings',
    DEFAULTS: {
      includeLink: false,
      includeAccount: false,
      includeThinking: false,
      includePromptNumber: true,
      enableNotifications: true,
      obsidianFolder: 'Gemini',
      obsidianVault: '',
      obsidianSilent: true,
      obsidianPromptFolder: true,
      obsidianFolderHistory: ['Gemini']
    }
  }
};
