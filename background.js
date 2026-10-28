// background.js
// Handles desktop notifications and tab activation for GemiBoost

const notificationTabs = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GENERATION_COMPLETE') {
    let isChinese = false;
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
        isChinese = chrome.i18n.getUILanguage().toLowerCase().startsWith('zh');
      }
    } catch (e) {}

    const title = isChinese ? '生成完成' : 'Generation Complete';
    let messageBody = isChinese
      ? 'Google Gemini 已经完成回复生成。'
      : 'Google Gemini has finished generating a response.';

    if (request.chatTitle) {
      messageBody = `[${request.chatTitle}]\n${messageBody}`;
    }

    try {
      chrome.notifications.create(
        {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: title,
          message: messageBody,
          priority: 2
        },
        (notificationId) => {
          if (sender && sender.tab) {
            notificationTabs.set(notificationId, {
              tabId: sender.tab.id,
              windowId: sender.tab.windowId
            });
          }
        }
      );
    } catch (e) {
      console.error('[GemiBoost] Failed to create notification:', e);
    }
  }
});

// Focus the relevant tab and window when user clicks the notification
chrome.notifications.onClicked.addListener((notificationId) => {
  const target = notificationTabs.get(notificationId);
  if (target) {
    if (typeof target.windowId === 'number') {
      try {
        chrome.windows.update(target.windowId, { focused: true });
      } catch (e) {}
    }
    if (typeof target.tabId === 'number') {
      try {
        chrome.tabs.update(target.tabId, { active: true });
      } catch (e) {}
    }
    notificationTabs.delete(notificationId);
  }
  try {
    chrome.notifications.clear(notificationId);
  } catch (e) {}
});

// Clean up stored tab mapping when notification is closed
chrome.notifications.onClosed.addListener((notificationId) => {
  notificationTabs.delete(notificationId);
});
