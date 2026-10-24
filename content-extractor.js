// content-extractor.js
// Centralized DOM parser and extractor for Gemini Web conversations and TOC items

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Extractor = {
  // Extract structured prompt data items from the current live DOM for TOC navigation
  extractFromDOM: function () {
    const userPrompts = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY);
    if (userPrompts.length === 0) return [];

    const extractedData = [];

    userPrompts.forEach((promptEl, index) => {
      // 1. Text extraction using textContent to prevent empty string from off-screen / content-visibility
      const textNode = promptEl.querySelector(GemiBoost.Config.SELECTORS.QUERY_TEXT) || promptEl;
      let text = textNode.textContent ? textNode.textContent.trim() : '';

      // Dynamically filter out hidden text intended for screen readers (e.g. "You said ", "你说了 ")
      const hiddenLabel = promptEl.querySelector(GemiBoost.Config.SELECTORS.HIDDEN_LABEL);
      if (hiddenLabel && hiddenLabel.textContent) {
        const hiddenText = hiddenLabel.textContent.trim();
        if (text.startsWith(hiddenText)) {
          text = text.substring(hiddenText.length).trim();
        }
      }

      const rawText = text;
      const fileTexts = new Set();

      // 2. Extract independent images (filter out user avatar and Google profile icons)
      const images = Array.from(promptEl.querySelectorAll('img')).filter((img) => {
        if (img.classList.contains('user-icon') || (img.src && img.src.includes('googleusercontent.com/a/'))) {
          return false;
        }
        const parentFile = img.closest(GemiBoost.Config.SELECTORS.FILE_CONTAINER);
        if (parentFile && parentFile.textContent && parentFile.textContent.trim()) {
          return false;
        }
        return true;
      });

      images.forEach((img, imgIndex) => {
        if (fileTexts.has(img.src)) return;
        fileTexts.add(img.src);

        extractedData.push({
          type: 'image',
          display: '[Image]',
          className: 'gemiboost-toc-item gemiboost-toc-attachment',
          queryIndex: index,
          subIndex: imgIndex,
          rawText: rawText
        });
      });

      // 3. Extract independent files
      const files = Array.from(promptEl.querySelectorAll(GemiBoost.Config.SELECTORS.FILE_CONTAINER));
      files.forEach((file, fileIndex) => {
        const fileText = file.textContent ? file.textContent.trim() : '';
        if (!fileText) return;

        if (fileTexts.has(fileText)) return;
        fileTexts.add(fileText);

        if (text.includes(fileText)) {
          text = text.replace(fileText, '').trim();
        }

        const lines = fileText.split('\n').map((l) => l.trim()).filter((l) => l);
        const fName = lines.length > 1 ? lines[lines.length - 1] : lines[0];

        let fileType = 'File';
        let fullFileName = fName;
        const btn = file.querySelector('button[aria-label]');
        if (btn && btn.getAttribute('aria-label')) {
          fullFileName = btn.getAttribute('aria-label');
        }

        const extMatch = fullFileName.match(/\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
          fileType = extMatch[1].toUpperCase();
        } else {
          const iconImg = file.querySelector('img[alt*="icon" i]');
          if (iconImg && iconImg.alt) {
            const altType = iconImg.alt.replace(/icon/i, '').trim().toUpperCase();
            if (altType.length > 0 && altType.length <= 5) {
              fileType = altType;
            }
          } else if (lines.length > 1) {
            const possibleType = lines[0].toUpperCase();
            if (possibleType.length > 0 && possibleType.length <= 5) {
              fileType = possibleType;
            }
          }
        }

        extractedData.push({
          type: 'file',
          display: `[${fileType}] ` + (fName.length > 30 ? fName.substring(0, 30) + '...' : fName),
          className: 'gemiboost-toc-item gemiboost-toc-attachment',
          queryIndex: index,
          subIndex: fileIndex,
          rawText: rawText
        });
      });

      // 4. Extract remaining pure text
      if (text) {
        const textPreview = text.length > 40 ? text.substring(0, 40) + '...' : text;
        extractedData.push({
          type: 'text',
          display: textPreview,
          title: text,
          className: 'gemiboost-toc-item',
          queryIndex: index,
          rawText: rawText
        });
      }

      // 5. Fallback if nothing was extracted
      if (!text && images.length === 0 && files.length === 0) {
        extractedData.push({
          type: 'empty',
          display: '[Empty]',
          className: 'gemiboost-toc-item',
          queryIndex: index,
          rawText: ''
        });
      }
    });

    return extractedData;
  },

  // Semantic alias for extractFromDOM
  extractTOCItems: function () {
    return this.extractFromDOM();
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
      const modelMarkdown = modelEl
        ? (GemiBoost.Markdown ? GemiBoost.Markdown.elementToMarkdown(modelEl) : modelEl.textContent || '')
        : '';

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
  }
};
