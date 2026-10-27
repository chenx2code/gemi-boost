// content-exporter.js
// Handles full conversation export orchestration, Markdown assembly, and browser download

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

      // 2. Extract conversation turns from live DOM (delegated to Extractor)
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
          onComplete: (fullItems) => {
            if (chatId && fullItems && fullItems.length > 0 && GemiBoost.Storage) {
              GemiBoost.Storage.saveChatCache(chatId, fullItems, true);
            }
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
          includeLink: false,
          includeAccount: false,
          includeThinking: false
        });
      }
    });
  },

  // Extract all (user-query, model-response) pairs in chronological order (delegates to Extractor)
  extractConversationData: function (settings = {}) {
    return GemiBoost.Extractor.extractConversationData(settings);
  },

  // Extract user Google account email from DOM if available (delegates to Extractor)
  extractUserAccount: function () {
    return GemiBoost.Extractor.extractUserAccount();
  },

  // Extract structured user turn (delegates to Extractor)
  extractUserTurn: function (promptEl) {
    return GemiBoost.Extractor.extractUserTurn(promptEl);
  },

  // Backward-compatible string extractor (delegates to Extractor)
  extractUserMessage: function (promptEl) {
    return GemiBoost.Extractor.extractUserMessage(promptEl);
  },

  // Locate the model-response element that corresponds to a user-query (delegates to Extractor)
  findAssociatedModelResponse: function (promptEl, index, allModelResponses) {
    return GemiBoost.Extractor.findAssociatedModelResponse(promptEl, index, allModelResponses);
  },

  // Extract the conversation title from DOM or document.title (delegates to Extractor)
  extractChatTitle: function () {
    return GemiBoost.Extractor.extractChatTitle();
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

  // Assemble full Markdown document with metadata and all turns
  assembleMarkdown: function (conversationData, settings = {}) {
    const { title, url, account, turns } = conversationData;

    // Detect environment language (Chinese vs English)
    const allText = (title || '') + turns.map((t) => (t.user && t.user.text) || '').join('');
    let isChinese = false;
    if (typeof document !== 'undefined' && document.documentElement?.lang) {
      isChinese = document.documentElement.lang.toLowerCase().startsWith('zh');
    } else if (typeof navigator !== 'undefined' && navigator.language) {
      isChinese = navigator.language.toLowerCase().startsWith('zh');
    } else {
      isChinese = /[\u4e00-\u9fa5]/.test(allText);
    }

    const parts = [];

    // 1. Single Root Heading (H1)
    parts.push(`# ${title}\n`);

    // 2. Document Metadata (based on user settings)
    const metaLines = [];
    if (settings.includeAccount && account) {
      const accountLabel = isChinese ? '账号' : 'Account';
      metaLines.push(`> **${accountLabel}:** ${account}`);
    }
    if (settings.includeLink && url) {
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
  },

  // Main entry point for exporting conversation directly to Obsidian
  exportToObsidian: async function (options = {}) {
    if (this.isExporting) return;

    const chatId = GemiBoost.Utils.getChatId();
    if (!chatId) {
      console.warn('[GemiBoost] Not on an active chat page.');
      return;
    }

    if (GemiBoost.Sync && GemiBoost.Sync.isCurrentlySyncing()) {
      if (GemiBoost.UI && GemiBoost.UI.setObsidianButtonState) {
        GemiBoost.UI.setObsidianButtonState('syncing', '正在同步历史记录中，请稍候...');
      }
      return;
    }

    this.isExporting = true;
    if (GemiBoost.UI && GemiBoost.UI.setObsidianButtonState) {
      GemiBoost.UI.setObsidianButtonState('loading', '正在准备导入 Obsidian...');
    }

    try {
      // 1. Ensure conversation is fully loaded from top to bottom
      await this.ensureFullHistoryLoaded();

      // Load user export preferences (from popup switches and settings)
      const settings = await this.loadExportSettings();

      // 2. Extract conversation turns from live DOM (delegated to Extractor)
      const conversationData = this.extractConversationData(settings);
      if (!conversationData || conversationData.turns.length === 0) {
        console.warn('[GemiBoost] No conversation turns found to export to Obsidian.');
        if (GemiBoost.UI && GemiBoost.UI.setObsidianButtonState) {
          GemiBoost.UI.setObsidianButtonState('idle');
        }
        return;
      }

      // 3. Assemble Markdown document
      const markdown = this.assembleMarkdown(conversationData, settings);

      // 4. Sanitize title and compute note path inside Obsidian
      const rawTitle = options.title !== undefined && options.title.trim() ? options.title : conversationData.title;
      const cleanTitle = this.sanitizeFilename(rawTitle).replace(/\.md$/i, '');
      const rawFolder = options.folder !== undefined ? String(options.folder) : (typeof settings.obsidianFolder === 'string' ? settings.obsidianFolder : 'Gemini');
      const folder = rawFolder.trim().replace(/^[\/\\\\]+|[\/\\\\]+$/g, '');
      const notePath = folder ? `${folder}/${cleanTitle}` : cleanTitle;

      // 5. Copy Markdown to clipboard (Official Obsidian 1.7.2+ clipboard-transit pattern)
      await this.writeToClipboard(markdown);

      // 6. Build official Obsidian URI scheme parameters
      // Using 'file' parameter ensures Obsidian resolves subfolder structures
      const params = new URLSearchParams();
      params.append('file', notePath);
      params.append('clipboard', 'true');

      const targetVault = options.vault !== undefined ? options.vault : settings.obsidianVault;
      if (targetVault && targetVault.trim()) {
        params.append('vault', targetVault.trim());
      }
      if (settings.obsidianSilent !== false) {
        params.append('silent', 'true');
      }

      const obsidianUri = `obsidian://new?${params.toString()}`;

      // 7. Trigger native URI dispatch
      this.triggerObsidianUri(obsidianUri);

      if (GemiBoost.UI && GemiBoost.UI.setObsidianButtonState) {
        GemiBoost.UI.setObsidianButtonState('success', `已导入到 Obsidian (${notePath})`);
        setTimeout(() => {
          GemiBoost.UI.setObsidianButtonState('idle');
        }, GemiBoost.Config.TIMING.EXPORT_FEEDBACK_MS || 1500);
      }
    } catch (err) {
      console.error('[GemiBoost] Error during Obsidian export:', err);
      if (GemiBoost.UI && GemiBoost.UI.setObsidianButtonState) {
        GemiBoost.UI.setObsidianButtonState('idle');
      }
    } finally {
      this.isExporting = false;
    }
  },

  // Safely write text to system clipboard with fallback
  writeToClipboard: async function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (err) {
        console.warn('[GemiBoost] navigator.clipboard.writeText failed, falling back to textarea execCommand:', err);
      }
    }

    // Fallback using document.execCommand('copy')
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!successful) {
      throw new Error('Failed to copy Markdown content to clipboard.');
    }
  },

  // Trigger Obsidian URI dispatch via hidden link click
  triggerObsidianUri: function (uri) {
    const a = document.createElement('a');
    a.href = uri;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) {
        document.body.removeChild(a);
      }
    }, 150);
  }
};
