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

      // Load user export preferences (from popup switches)
      const settings = await this.loadExportSettings();

      // 2. Extract conversation turns from live DOM
      const conversationData = this.extractConversationData(settings);
      if (!conversationData || conversationData.turns.length === 0) {
        console.warn('[GemiBoost] No conversation turns found to export.');
        if (GemiBoost.UI) {
          GemiBoost.UI.setExportButtonState('idle');
        }
        return;
      }

      // 3. Assemble Markdown document
      const markdown = this.assembleMarkdown(conversationData, settings);

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

  // Load export settings from storage (async Promise)
  loadExportSettings: function () {
    return new Promise((resolve) => {
      if (GemiBoost.Storage && GemiBoost.Storage.loadExportSettings) {
        GemiBoost.Storage.loadExportSettings((settings) => {
          resolve(settings);
        });
      } else {
        resolve({
          includeThought: true,
          includeLink: true,
          includeAccount: false
        });
      }
    });
  },

  // Strip thought process blockquotes or details as a fallback
  stripThoughtProcess: function (markdown) {
    if (!markdown) return '';
    return markdown
      .replace(/> \*\*\[(?:思考过程|Thinking Process|Thought Process)\]\*\*[\s\S]*?(?=\n\n[^\>]|\n\n$|$)/gi, '')
      .replace(/<details[^>]*>[\s\S]*?<\/details>/gi, '')
      .trim();
  },

  // Extract all (user-query, model-response) pairs in chronological order
  extractConversationData: function (settings = {}) {
    const title = this.extractChatTitle();
    const account = settings.includeAccount ? this.extractUserAccount() : '';
    const userPrompts = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY));
    const modelResponses = Array.from(document.querySelectorAll(GemiBoost.Config.SELECTORS.MODEL_RESPONSE));

    const turns = [];

    userPrompts.forEach((promptEl, index) => {
      // 1. Extract user message and attachments
      const userTurn = this.extractUserTurn(promptEl);

      // 2. Find associated model response
      const modelEl = this.findAssociatedModelResponse(promptEl, index, modelResponses);
      let modelMarkdown = modelEl ? GemiBoost.Markdown.elementToMarkdown(modelEl, settings) : '';

      if (settings.includeThought === false && modelMarkdown) {
        modelMarkdown = this.stripThoughtProcess(modelMarkdown);
      }

      turns.push({
        turnIndex: index + 1,
        user: userTurn,
        model: modelMarkdown
      });
    });

    return {
      title,
      url: location.href,
      account,
      exportedAt: new Date(),
      turns
    };
  },

  // Extract user Google account email from DOM if available
  extractUserAccount: function () {
    try {
      // 1. Check account / avatar button with aria-label or data attributes
      const candidates = Array.from(
        document.querySelectorAll(
          'button[aria-label*="@"], a[aria-label*="@"], [data-identifier*="@"], [data-email*="@"], [aria-label*="Google 账号"], [aria-label*="Google Account"]'
        )
      );

      for (const el of candidates) {
        const text = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-identifier') || ''} ${el.getAttribute('data-email') || ''} ${el.title || ''}`;
        const match = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (match) {
          return match[1];
        }
      }

      // 2. Fallback: inspect user avatar icon image alt or title
      const userIcons = Array.from(document.querySelectorAll('img.user-icon, [class*="avatar"] img'));
      for (const img of userIcons) {
        const match = (img.alt || img.title || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (match) {
          return match[1];
        }
      }
    } catch (e) {
      console.warn('[GemiBoost] Could not extract user account:', e);
    }
    return '';
  },

  // Extract structured user turn (text content and attached multimodal files)
  extractUserTurn: function (promptEl) {
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

    const attachments = [];

    // B. Images uploaded by user
    const images = Array.from(promptEl.querySelectorAll('img')).filter((img) => {
      if (
        img.classList.contains('user-icon') ||
        img.classList.contains('avatar') ||
        (img.src && (img.src.includes('googleusercontent.com/a/') || img.src.includes('gstatic.com'))) ||
        img.getAttribute('aria-hidden') === 'true'
      ) {
        return false;
      }
      const parentFile = img.closest(GemiBoost.Config.SELECTORS.FILE_CONTAINER);
      return !(parentFile && parentFile.textContent && parentFile.textContent.trim());
    });

    images.forEach(() => {
      attachments.push('[Image]');
    });

    // C. Attached files & documents (strictly match genuine file preview containers)
    const fileElements = Array.from(
      promptEl.querySelectorAll(
        `${GemiBoost.Config.SELECTORS.FILE_CONTAINER}, [data-test-id*="file-preview"], [data-test-id*="attachment"]`
      )
    );

    fileElements.forEach((fileEl) => {
      if (fileEl.closest('.cdk-visually-hidden')) return;

      const fileText = fileEl.textContent ? fileEl.textContent.trim() : '';
      if (!fileText && !fileEl.querySelector('video, audio')) return;

      const lower = fileText.toLowerCase();
      const elHtml = fileEl.outerHTML.toLowerCase();

      const isYouTube =
        lower.includes('youtube') ||
        elHtml.includes('youtube') ||
        elHtml.includes('youtu.be') ||
        /\.(mp4|mov|webm|mkv)($|\s)/i.test(lower);
      const isAudio =
        /\.(mp3|wav|m4a|aac|ogg|flac)($|\s)/i.test(lower) ||
        elHtml.includes('audio') ||
        fileEl.querySelector('audio');
      const isPdf = /\.pdf($|\s)/i.test(lower);
      const isMarkdown = /\.(md|markdown)($|\s)/i.test(lower);
      const isImageFile = /\.(png|jpe?g|gif|webp|bmp|svg)($|\s)/i.test(lower);
      const hasFileExtension = /\.[a-zA-Z0-9]{2,5}($|\s)/.test(lower);

      if (isYouTube) {
        attachments.push('[YouTube Video]');
      } else if (isAudio) {
        attachments.push('[Audio File]');
      } else if (isPdf) {
        attachments.push('[PDF File]');
      } else if (isMarkdown) {
        attachments.push('[Markdown File]');
      } else if (isImageFile) {
        if (images.length === 0) {
          attachments.push('[Image]');
        }
      } else if (hasFileExtension || fileEl.matches(GemiBoost.Config.SELECTORS.FILE_CONTAINER)) {
        // Genuine file attachment with a filename or inside a verified file container
        if (fileText.length > 0 && fileText.length < 150) {
          attachments.push('[Document]');
        }
      }

      if (fileText && text.includes(fileText)) {
        text = text.replace(fileText, '').trim();
      }
    });

    return {
      text,
      attachments
    };
  },

  // Backward-compatible string extractor
  extractUserMessage: function (promptEl) {
    const turn = this.extractUserTurn(promptEl);
    const parts = [];
    if (turn.attachments) parts.push(...turn.attachments.map((a) => `> ${a}`));
    if (turn.text) parts.push(turn.text);
    return parts.join('\n\n');
  },

  // Format user turn according to heading hierarchy and truncation rules
  formatUserTurn: function (turnIndex, userTurnData, isChinese) {
    const text = userTurnData && userTurnData.text ? userTurnData.text.trim() : '';
    const attachments = (userTurnData && userTurnData.attachments) || [];

    const promptLabel = isChinese ? '用户提问' : 'User Prompt';
    let heading = '';
    let quoteBlock = '';
    const attachmentQuotes = [];

    if (text) {
      const isMultiline = text.includes('\n');
      if (!isMultiline) {
        if (text.length <= 200) {
          // Short prompt (single line & <= 200 chars): direct H2
          heading = text;
        } else {
          // Overlong prompt (single line > 200 chars): truncate to 200 with ...
          heading = text.substring(0, 200) + '...';
          quoteBlock =
            `> **[${promptLabel}]**\n` +
            text
              .split('\n')
              .map((l) => (l.trim() ? `> ${l}` : '>'))
              .join('\n');
        }
      } else {
        // Multiline prompt: first line as H2, full text in quote block
        const lines = text.split('\n');
        let firstLine = lines[0].trim();
        if (firstLine.length > 200) {
          heading = firstLine.substring(0, 200) + '...';
        } else {
          // Clean up trailing colons on heading line to match standard outline style
          heading = firstLine.replace(/[:：]$/, '...');
        }
        quoteBlock =
          `> **[${promptLabel}]**\n` +
          lines.map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');
      }

      // Attachments follow heading as blockquotes
      attachments.forEach((att) => {
        attachmentQuotes.push(`> ${att}`);
      });
    } else {
      if (attachments.length > 0) {
        // No text, only attachments: first attachment promotes to H2
        heading = attachments[0];
        for (let i = 1; i < attachments.length; i++) {
          attachmentQuotes.push(`> ${attachments[i]}`);
        }
      } else {
        heading = isChinese ? '未命名提问' : 'Untitled Prompt';
      }
    }

    const finalHeading = `## ${heading}`;

    const parts = [finalHeading];
    if (attachmentQuotes.length > 0) {
      parts.push(attachmentQuotes.join('\n\n'));
    }
    if (quoteBlock) {
      parts.push(quoteBlock);
    }

    return parts.join('\n\n');
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
  assembleMarkdown: function (conversationData, settings = {}) {
    const { title, url, account, turns } = conversationData;

    // Detect environment language (Chinese vs English)
    const allText = (title || '') + turns.map((t) => (t.user && t.user.text) || '').join('');
    const isChinese =
      /[\u4e00-\u9fa5]/.test(allText) ||
      (document.documentElement.lang && document.documentElement.lang.startsWith('zh'));

    const parts = [];

    // 1. Single Root Heading (H1)
    parts.push(`# ${title}\n`);

    // 2. Document Metadata (based on user settings)
    const metaLines = [];
    if (settings.includeAccount && account) {
      const accountLabel = isChinese ? '账号' : 'Account';
      metaLines.push(`> **${accountLabel}:** ${account}`);
    }
    if (settings.includeLink !== false && url) {
      const linkLabel = isChinese ? '原始对话链接' : 'Original Chat Link';
      metaLines.push(`> **${linkLabel}:** [${url}](${url})`);
    }

    if (metaLines.length > 0) {
      parts.push(metaLines.join('\n'));
      parts.push('\n---\n');
    }

    // 3. Conversation Turns
    turns.forEach((turn) => {
      // User turn (H2)
      const userMarkdown = this.formatUserTurn(turn.turnIndex, turn.user, isChinese);
      parts.push(userMarkdown);

      // AI response (demoted to H3+)
      if (turn.model) {
        const demotedModel = GemiBoost.Markdown.demoteAIHeadings(turn.model);
        parts.push(demotedModel);
      } else {
        parts.push(isChinese ? '*(无回答内容)*' : '*(No response)*');
      }

      // Turn separator line
      parts.push('\n---\n');
    });

    return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  },

  // Sanitize filename according to cross-platform and length constraints
  sanitizeFilename: function (title) {
    const isChinese = typeof title === 'string' && /[\u4e00-\u9fa5]/.test(title);
    const defaultTitle = isChinese ? '未命名对话' : 'Untitled Conversation';

    let cleanTitle = (title || '').trim();
    if (!cleanTitle || cleanTitle.toLowerCase() === 'gemini' || cleanTitle === 'Gemini_Conversation') {
      cleanTitle = defaultTitle;
    }

    // 1. Cross-platform safe filtering: \ / : * ? " < > | and ASCII control characters (0-31, 127) -> _
    cleanTitle = cleanTitle.replace(new RegExp('[\\\\/:*?"<>|\\x00-\\x1f\\x7f]', 'g'), '_');

    // 2. Collapse consecutive underscores
    cleanTitle = cleanTitle.replace(/_+/g, '_');

    // 3. Border handling: strip leading and trailing dots and whitespace
    cleanTitle = cleanTitle.replace(/^[\s.]+|[\s.]+$/g, '');

    // 4. Max 100 characters truncation
    if (cleanTitle.length > 100) {
      cleanTitle = cleanTitle.substring(0, 100);
      cleanTitle = cleanTitle.replace(/^[\s.]+|[\s.]+$/g, '');
    }

    if (!cleanTitle) {
      cleanTitle = defaultTitle;
    }

    return `${cleanTitle}.md`;
  },

  // Backward-compatible alias for sanitizeFilename
  generateFilename: function (title) {
    return this.sanitizeFilename(title);
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
