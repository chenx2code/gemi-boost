// content-notification.js
// Smart background desktop notifications for GemiBoost

window.GemiBoost = window.GemiBoost || {};

(function () {
  'use strict';

  let isGenerating = false;
  let enableNotifications = true;
  let lastActivityTime = Date.now();
  let lastUpdateTime = 0;
  const ACTIVITY_TIMEOUT = 5000; // 5 seconds window to detect user presence

  // Performance optimization: Throttle interaction updates to at most once per 1000ms
  function updateActivity() {
    const now = Date.now();
    if (now - lastUpdateTime > 1000) {
      lastActivityTime = now;
      lastUpdateTime = now;
    }
  }

  // Find stop button in Gemini web DOM using known selectors and fallbacks
  function findStopButton() {
    const selector = (GemiBoost.Config && GemiBoost.Config.SELECTORS && GemiBoost.Config.SELECTORS.STOP_BUTTON) || [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="停止" i]',
      'button[aria-label*="応答を停止" i]',
      'button[data-testid*="stop" i]',
      'button[data-test-id*="stop" i]',
      'button.stop-button',
      'button.stop-generating-button',
      'mat-icon[data-mat-icon-name*="stop" i]',
      'mat-icon[fonticon*="stop" i]'
    ].join(', ');

    try {
      const match = document.querySelector(selector);
      if (match) {
        return match.closest('button') || match;
      }
    } catch (e) {
      // In case of selector parse errors
    }

    // Fallback: check mat-icon elements with "stop" in attribute or text
    const matIcons = document.querySelectorAll('mat-icon');
    for (let i = 0; i < matIcons.length; i++) {
      const icon = matIcons[i];
      const iconName = icon.getAttribute('data-mat-icon-name') || icon.getAttribute('fonticon') || icon.textContent || '';
      if (iconName.toLowerCase().includes('stop')) {
        const btn = icon.closest('button');
        if (btn) return btn;
      }
    }

    return null;
  }

  // Initialize notification observers and listeners
  function init() {
    const storageKey = (GemiBoost.Config && GemiBoost.Config.SETTINGS && GemiBoost.Config.SETTINGS.STORAGE_KEY) || 'gemiboost_export_settings';

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['enableNotifications', storageKey], (result) => {
        if (result && result.enableNotifications !== undefined) {
          enableNotifications = result.enableNotifications !== false;
        } else if (result && result[storageKey] && result[storageKey].enableNotifications !== undefined) {
          enableNotifications = result[storageKey].enableNotifications !== false;
        } else {
          enableNotifications = true;
        }
      });

      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
          if (changes.enableNotifications) {
            enableNotifications = changes.enableNotifications.newValue !== false;
          } else if (changes[storageKey] && changes[storageKey].newValue && changes[storageKey].newValue.enableNotifications !== undefined) {
            enableNotifications = changes[storageKey].newValue.enableNotifications !== false;
          }
        }
      });
    }

    // Listen for user interactions to determine if they are actively using the page
    // even if the window doesn't have system focus (e.g., scrolling a background window).
    const options = { passive: true, capture: true };
    window.addEventListener('wheel', updateActivity, options);
    window.addEventListener('mousemove', updateActivity, options);
    window.addEventListener('keydown', updateActivity, options);
    window.addEventListener('touchstart', updateActivity, options);
  }

  // Evaluate generation state and trigger notification on completion if tab is inactive
  function checkGenerationState() {
    if (!enableNotifications) return;

    const stopBtn = findStopButton();

    if (stopBtn && !isGenerating) {
      // Generation has started
      isGenerating = true;
    } else if (!stopBtn && isGenerating) {
      // Generation has just completed
      isGenerating = false;

      const isRecentlyActive = (Date.now() - lastActivityTime) < ACTIVITY_TIMEOUT;

      // We consider the user is NOT looking at the window if:
      // 1. The tab is hidden (e.g. switched tabs or minimized) OR
      // 2. The window doesn't have focus AND they haven't interacted with it recently (e.g. background scrolling)
      const shouldNotify = document.hidden || (!document.hasFocus() && !isRecentlyActive);

      if (shouldNotify) {
        try {
          const finalTitle = GemiBoost.Extractor ? GemiBoost.Extractor.extractChatTitle() : '';

          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              type: 'GENERATION_COMPLETE',
              chatTitle: finalTitle
            });
          }
        } catch (e) {
          console.error('[GemiBoost] Failed to send notification message:', e);
        }
      }
    }
  }

  // Reset generating state (e.g. on route change)
  function resetState() {
    isGenerating = false;
  }

  GemiBoost.Notification = {
    init: init,
    checkGenerationState: checkGenerationState,
    resetState: resetState,
    getIsGenerating: function () {
      return isGenerating;
    }
  };
})();
