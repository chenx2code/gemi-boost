// content-exporter.js
// Handles full conversation extraction, Markdown assembly, and browser download

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Exporter = {
  isExporting: false,

  // Check if an export process is currently running
  isCurrentlyExporting: function () {
    return this.isExporting;
  },

  // Main entry point for exporting conversation to Markdown
  exportToMarkdown: async function () {
    if (this.isExporting) return;

    const chatId = GemiBoost.Utils.getChatId();
    if (!chatId) {
      console.warn('[GemiBoost] Not on an active chat page.');
      return;
    }

    if (GemiBoost.Sync && GemiBoost.Sync.isCurrentlySyncing()) {
      if (GemiBoost.UI) {
        GemiBoost.UI.setExportButtonState('syncing', '正在同步历史记录中，请稍候...');
      }
      return;
    }

    this.isExporting = true;
    if (GemiBoost.UI) {
      GemiBoost.UI.setExportButtonState('exporting', '正在准备导出全量对话...');
    }

    try {
      // 1. Ensure conversation is fully loaded from top to bottom
      await this.ensureFullHistoryLoaded();

      // 2. Extract conversation turns from live DOM
      const conversationData = this.extractConversationData();
      if (!conversationData || conversationData.turns.length === 0) {
        console.warn('[GemiBoost] No conversation turns found to export.');
        if (GemiBoost.UI) {
          GemiBoost.UI.setExportButtonState('idle');
        }
        return;
      }

      // 3. Assemble Markdown document
      const markdown = this.assembleMarkdown(conversationData);

      // 4. Download file
      const filename = this.generateFilename(conversationData.title);
      this.triggerDownload(markdown, filename);

      if (GemiBoost.UI) {
        GemiBoost.UI.setExportButtonState('success', `已导出 ${conversationData.turns.length} 轮对话至 ${filename}`);
        setTimeout(() => {
          GemiBoost.UI.setExportButtonState('idle');
        }, GemiBoost.Config.TIMING.EXPORT_FEEDBACK_MS || 1500);
      }
    } catch (err) {
      console.error('[GemiBoost] Error during Markdown export:', err);
      if (GemiBoost.UI) {
        GemiBoost.UI.setExportButtonState('idle');
      }
    } finally {
      this.isExporting = false;
    }
  },

  // Check and trigger sync if older turns might not be loaded into DOM
  ensureFullHistoryLoaded: function () {
    return new Promise((resolve) => {
      const scroller = GemiBoost.Utils.getChatScrollContainer();
      if (!scroller) {
        return resolve();
      }

      // If the chat content has no scroll overflow, all messages are already in DOM
      if (scroller.scrollHeight <= scroller.clientHeight + 50) {
        return resolve();
      }

      // If already at scrollTop 0 and has been synced, proceed directly
      // Otherwise, trigger GemiBoost.Sync to scroll up and hydrate full history
      const chatId = GemiBoost.Utils.getChatId();
      GemiBoost.Storage.loadChatCache(chatId, (cached) => {
        const domCount = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY).length;
        const cachedCount = cached?.items?.length || 0;

        // If the cache was fully synced AND the live DOM actually contains all those turns,
        // we are already at the complete state and can proceed directly.
        if (cached && cached.isFullySynced && cachedCount > 0 && domCount >= cachedCount) {
          return resolve();
        }

        // Otherwise (fresh page load or partially loaded), run the full sync loop
        // which scrolls up to the very first prompt.
        if (GemiBoost.UI) {
          GemiBoost.UI.setExportButtonState('syncing', '正在同步更早的历史记录...');
        }

        GemiBoost.Sync.triggerSync({
          silentUI: true,
          onBatchLoaded: (count) => {
            if (GemiBoost.UI) {
              GemiBoost.UI.setExportButtonState('syncing', `正在加载历史记录 (已加载 ${count} 条)...`);
            }
          },
          onComplete: () => {
            resolve();
          },
          onAborted: () => {
            resolve();
          }
        });
      });
    });
  },

  // Extract all (user-query, model-response) pairs in chronological order
  extractConversationData: function () {
    const title = this.extractChatTitle();
    const userPrompts = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
    const modelResponses = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.MODEL_RESPONSE));

    const turns = [];

    userPrompts.forEach((promptEl, index) => {
      // 1. Extract user message
      const userMessage = this.extractUserMessage(promptEl);

      // 2. Find associated model response
      const modelEl = this.findAssociatedModelResponse(promptEl, index, modelResponses);
      const modelMarkdown = modelEl ? GemiBoost.Markdown.elementToMarkdown(modelEl) : '';

      turns.push({
        turnIndex: index + 1,
        user: userMessage,
        model: modelMarkdown
      });
    });

    return {
      title,
      url: location.href,
      exportedAt: new Date(),
      turns
    };
  },

  // Extract user text, images, and attachments from a user-query element
  extractUserMessage: function (promptEl) {
    // A. Text content
    const textNode = promptEl.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || promptEl;
    let text = textNode.textContent ? textNode.textContent.trim() : '';

    // Strip hidden screen-reader labels ("You said ", "你说了 ")
    const hiddenLabel = promptEl.querySelector(GemiBoost.Config.SELECTORS.HIDDEN_LABEL);
    if (hiddenLabel && hiddenLabel.textContent) {
      const hiddenText = hiddenLabel.textContent.trim();
      if (text.startsWith(hiddenText)) {
        text = text.substring(hiddenText.length).trim();
      }
    }

    const lines = [];

    // B. Images uploaded by user
    const images = Array.from(promptEl.querySelectorAll('img')).filter((img) => {
      if (img.classList.contains('user-icon') || (img.src && img.src.includes('googleusercontent.com/a/'))) {
        return false;
      }
      const parentFile = img.closest(GemiBoost.Config.SELECTORS.FILE_CONTAINER);
      return !(parentFile && parentFile.textContent && parentFile.textContent.trim());
    });

    images.forEach((img) => {
      if (img.src) {
        lines.push(`![User Image](${img.src})`);
      }
    });

    // C. Attached files
    const files = Array.from(promptEl.querySelectorAll(GemiBoost.Config.SELECTORS.FILE_CONTAINER));
    files.forEach((file) => {
      const fileText = file.textContent ? file.textContent.trim() : '';
      if (fileText) {
        if (text.includes(fileText)) {
          text = text.replace(fileText, '').trim();
        }
        const fileLines = fileText.split('\n').map((l) => l.trim()).filter((l) => l);
        const fileName = fileLines.length > 1 ? fileLines[fileLines.length - 1] : fileLines[0];
        lines.push(`📎 **[File] ${fileName}**`);
      }
    });

    // D. Main text
    if (text) {
      lines.push(text);
    }

    return lines.join('\n\n');
  },

  // Locate the model-response element that corresponds to a user-query
  findAssociatedModelResponse: function (promptEl, index, allModelResponses) {
    // Strategy 1: Forward sibling traversal
    let next = promptEl.nextElementSibling;
    while (next && !next.matches?.(GemiBoost.Config.SELECTORS.USER_QUERY)) {
      if (next.matches?.(GemiBoost.Config.SELECTORS.MODEL_RESPONSE)) {
        return next;
      }
      const childModel = next.querySelector?.(GemiBoost.Config.SELECTORS.MODEL_RESPONSE);
      if (childModel) {
        return childModel;
      }
      next = next.nextElementSibling;
    }

    // Strategy 2: Common parent wrapper
    const parentContainer = promptEl.parentElement;
    if (parentContainer) {
      const containerModel = parentContainer.querySelector(GemiBoost.Config.SELECTORS.MODEL_RESPONSE);
      if (containerModel) {
        return containerModel;
      }
    }

    // Strategy 3: Index-based mapping fallback
    if (index < allModelResponses.length) {
      return allModelResponses[index];
    }

    return null;
  },

  // Extract the conversation title from DOM or document.title
  extractChatTitle: function () {
    const titleEl = document.querySelector(GemiBoost.Config.SELECTORS.CHAT_TITLE);
    if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
      return titleEl.textContent.trim();
    }

    const docTitle = document.title || '';
    const cleaned = docTitle
      .replace(/ - Google Gemini$/i, '')
      .replace(/ - Gemini$/i, '')
      .replace(/^Gemini - /i, '')
      .trim();

    if (cleaned && cleaned.toLowerCase() !== 'gemini') {
      return cleaned;
    }

    const firstQuery = GemiBoost.Utils.getFirstQueryText();
    if (firstQuery) {
      return firstQuery.substring(0, 30);
    }

    return 'Gemini_Conversation';
  },

  // Assemble full Markdown document with metadata and all turns
  assembleMarkdown: function (conversationData) {
    const { title, url, exportedAt, turns } = conversationData;
    const dateStr = exportedAt.toISOString().replace('T', ' ').substring(0, 19);

    const parts = [];

    // Header & Metadata
    parts.push(`# ${title}\n`);
    parts.push(`> **Export Date**: ${dateStr}  `);
    parts.push(`> **Chat URL**: [${url}](${url})  `);
    parts.push(`> **Exported By**: [GemiBoost](https://github.com/chenx2code/gemi-boost)\n`);
    parts.push('---\n');

    // Dialogue turns
    turns.forEach((turn) => {
      parts.push(`### 👤 User\n\n${turn.user || '*(Empty prompt)*'}\n`);
      parts.push(`### 🤖 Gemini\n\n${turn.model || '*(Empty response)*'}\n`);
      parts.push('---\n');
    });

    return parts.join('\n');
  },

  // Generate safe filename for the downloaded file
  generateFilename: function (title) {
    const safeTitle = (title || 'Gemini_Conversation')
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 50);

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    return `Gemini_${safeTitle}_${yyyy}${mm}${dd}.md`;
  },

  // Trigger client-side file download via dynamic Blob URL
  triggerDownload: function (content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
};
