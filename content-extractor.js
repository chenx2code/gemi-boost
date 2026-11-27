// content-extractor.js
// Centralized DOM parser and extractor for Gemini Web conversations and TOC items

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Extractor = {
  MAX_IMAGE_FILENAME_MAP_SIZE: 2000,
  imageFilenameMap: new Map(),
  _onImageFilenamesUpdated: null,
  _interceptorBridgeBound: false,

  // Identify generic UI placeholder labels vs real image filenames
  isPlaceholderImageLabel: function (val) {
    if (!val || typeof val !== 'string') return true;
    const clean = val.trim().toLowerCase();
    if (!clean) return true;

    const hasImageExt = /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|tiff?|heic|heif|avif|jfif|dng|raw|psd)$/i.test(clean);
    if (
      hasImageExt &&
      !clean.startsWith('show the uploaded image') &&
      !clean.startsWith('open the uploaded image')
    ) {
      return false;
    }

    return (
      clean === 'uploaded image preview' ||
      clean === 'uploaded image' ||
      clean === 'image preview' ||
      clean === 'preview image' ||
      clean === 'preview' ||
      clean === 'image' ||
      clean === '[image]' ||
      clean === 'open image in lightbox' ||
      clean === 'remove attachment' ||
      clean === 'delete attachment' ||
      clean === 'image attachment' ||
      clean === 'user uploaded image' ||
      clean === '图片' ||
      clean === '上传的图片预览' ||
      clean === '上传的图片' ||
      clean === '图片预览' ||
      clean === '预览图片' ||
      clean === '移除图片' ||
      clean === '删除图片' ||
      clean === '移除附件' ||
      clean === '删除附件' ||
      clean === '图片附件' ||
      clean.includes('in a lightbox') ||
      clean.startsWith('show the uploaded image') ||
      clean.startsWith('open image') ||
      clean.startsWith('view image') ||
      clean.startsWith('remove image') ||
      clean.startsWith('delete image') ||
      clean.startsWith('打开图片') ||
      clean.startsWith('查看图片') ||
      clean.startsWith('查看大图') ||
      clean.startsWith('在灯箱中显示')
    );
  },

  // Set key in bounded Map to avoid unbounded growth over long sessions
  _setBoundedImageFilename: function (key, value) {
    if (!key) return false;
    if (this.imageFilenameMap.get(key) === value) return false;
    if (!this.imageFilenameMap.has(key) && this.imageFilenameMap.size >= this.MAX_IMAGE_FILENAME_MAP_SIZE) {
      const oldestKey = this.imageFilenameMap.keys().next().value;
      if (oldestKey !== undefined) {
        this.imageFilenameMap.delete(oldestKey);
      }
    }
    this.imageFilenameMap.set(key, value);
    return true;
  },

  // Normalize image URL by stripping query params, hash fragments, and FIFE trailing options
  normalizeImageUrl: function (url) {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    return url.split('#')[0].split('?')[0].replace(/=[^/]+$/, '');
  },

  // Register intercepted URL -> filename mappings and return true if anything changed
  registerImageFilenames: function (entries) {
    if (!Array.isArray(entries) || entries.length === 0) return false;
    let hasUpdates = false;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || typeof entry.url !== 'string' || typeof entry.fileName !== 'string') continue;
      const cleanName = entry.fileName.trim();
      if (!cleanName || this.isPlaceholderImageLabel(cleanName)) continue;

      if (this._setBoundedImageFilename(entry.url, cleanName)) {
        hasUpdates = true;
      }
      const normalized = this.normalizeImageUrl(entry.url);
      if (normalized && this._setBoundedImageFilename(normalized, cleanName)) {
        hasUpdates = true;
      }
    }
    return hasUpdates;
  },

  // Look up intercepted filename for a DOM image src
  lookupImageFilename: function (url) {
    if (!url || typeof url !== 'string') return '';
    const direct = this.imageFilenameMap.get(url);
    if (direct) return direct;
    const normalized = this.normalizeImageUrl(url);
    return normalized ? (this.imageFilenameMap.get(normalized) || '') : '';
  },

  rpcActivity: { inFlightCount: 0, lastPhase: 'idle', lastUpdatedAt: 0 },
  _rpcActivityListeners: new Set(),

  // Return latest batchexecute RPC activity snapshot from MAIN world
  getRpcActivity: function () {
    return this.rpcActivity;
  },

  // Subscribe to MAIN-world RPC activity changes (returns unsubscribe handler)
  onRpcActivityChange: function (listener) {
    if (typeof listener !== 'function') return () => {};
    this._rpcActivityListeners.add(listener);
    return () => this._rpcActivityListeners.delete(listener);
  },

  // Register callback notified when asynchronous RPC interception yields new image filenames
  setOnImageFilenamesUpdated: function (callback) {
    this._onImageFilenamesUpdated = typeof callback === 'function' ? callback : null;
  },

  // Bind postMessage bridge with the MAIN world RPC interceptor and request buffered state
  initImageFilenameBridge: function () {
    if (this._interceptorBridgeBound || typeof window === 'undefined' || !window.addEventListener) return;
    this._interceptorBridgeBound = true;

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== 'gemiboost-main') return;

      if (data.type === 'RPC_ACTIVITY') {
        this.rpcActivity = {
          inFlightCount: Math.max(0, Number(data.inFlightCount) || 0),
          lastPhase: data.phase || 'idle',
          lastUpdatedAt: Number(data.timestamp) || Date.now()
        };
        this._rpcActivityListeners.forEach((fn) => {
          try {
            fn(this.rpcActivity);
          } catch (e) {}
        });
        return;
      }

      if (data.type !== 'IMAGE_FILENAMES') return;
      if (!Array.isArray(data.entries) || data.entries.length === 0) return;

      const hasUpdates = this.registerImageFilenames(data.entries);
      if (hasUpdates && typeof this._onImageFilenamesUpdated === 'function') {
        this._onImageFilenamesUpdated();
      }
    });

    try {
      window.postMessage(
        {
          source: 'gemiboost-isolated',
          type: 'REQUEST_IMAGE_FILENAMES'
        },
        window.location.origin
      );
      window.postMessage(
        {
          source: 'gemiboost-isolated',
          type: 'REQUEST_RPC_ACTIVITY'
        },
        window.location.origin
      );
    } catch (e) {}
  },

  // Extract and clean raw prompt text from a query DOM node, stripping hidden screen reader labels
  getCleanPromptText: function (promptEl) {
    return GemiBoost.Utils ? GemiBoost.Utils.getCleanPromptText(promptEl) : '';
  },

  // Extract prompt text while excluding any attachment/quote DOM subtrees nested inside the text container
  getPromptTextWithoutAttachments: function (promptEl, attachmentEls = []) {
    if (!promptEl) return '';
    const textNode = promptEl.querySelector?.(GemiBoost.Config.SELECTORS.QUERY_TEXT) || promptEl;
    const isWholePromptFallback = textNode === promptEl;
    const hasNestedAttachments =
      isWholePromptFallback ||
      (typeof textNode.contains === 'function' && attachmentEls.some((el) => el && textNode.contains(el)));

    if (!hasNestedAttachments || typeof textNode.cloneNode !== 'function') {
      return this.getCleanPromptText(promptEl);
    }

    const clone = textNode.cloneNode(true);
    const baseSelectorsToStrip = [
      GemiBoost.Config.SELECTORS.FILE_CONTAINER,
      GemiBoost.Config.SELECTORS.FILE_CARD,
      'user-query-file-preview',
      'user-query-file-carousel',
      '.submitted-quote-container',
      '.submitted-quote-in-query',
      '[class*="submitted-quote"]',
      '.quote-preview-container',
      '[class*="quote-preview"]',
      '.citation-preview',
      '[class*="citation-preview"]',
      '[data-test-id*="file-preview"]',
      '[data-test-id*="attachment"]'
    ];
    if (isWholePromptFallback) {
      baseSelectorsToStrip.push(
        GemiBoost.Config.SELECTORS.QUOTE_CONTAINER,
        '[class*="image-preview"]',
        '[data-test-id*="image-preview"]',
        'button',
        'mat-icon',
        'gem-icon'
      );
    }
    const selectorsToStrip = baseSelectorsToStrip.filter(Boolean).join(', ');

    if (typeof clone.querySelectorAll === 'function') {
      if (selectorsToStrip) {
        clone.querySelectorAll(selectorsToStrip).forEach((el) => el.remove());
      }
      if (GemiBoost.Config.SELECTORS.HIDDEN_LABEL) {
        clone.querySelectorAll(GemiBoost.Config.SELECTORS.HIDDEN_LABEL).forEach((el) => el.remove());
      }
    }

    let text = clone.textContent ? clone.textContent.trim() : '';
    const hiddenLabel = promptEl.querySelector?.(GemiBoost.Config.SELECTORS.HIDDEN_LABEL);
    if (hiddenLabel && hiddenLabel.textContent) {
      const hiddenText = hiddenLabel.textContent.trim();
      if (text.startsWith(hiddenText)) {
        text = text.substring(hiddenText.length).trim();
      }
    }
    return text;
  },

  // Extract structured file metadata (full filename with extension, fileType, folder flag, category)
  extractFileInfo: function (fileEl, fileText) {
    const text = fileText || (fileEl && fileEl.textContent ? fileEl.textContent.trim() : '');
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
    const labelEl = fileEl && fileEl.querySelector?.('[data-test-id="filename-label"], .filename-label');
    const labelText = labelEl && labelEl.textContent ? labelEl.textContent.replace(/\s+/g, ' ').trim() : '';
    const visibleName = labelText || (lines.length > 1 ? lines[lines.length - 1] : (lines[0] || ''));

    const isFolder = this._hasFolderIndicator(fileEl);

    let fullFileName = visibleName;
    let resolvedName = visibleName;
    const rawAttrCandidates = [];
    if (fileEl) {
      rawAttrCandidates.push(
        { raw: fileEl.getAttribute?.('data-filename'), allowStrip: false },
        { raw: fileEl.getAttribute?.('data-name'), allowStrip: false }
      );
      const dataFileEl = fileEl.querySelector?.('[data-filename], [data-name]');
      if (dataFileEl) {
        rawAttrCandidates.push(
          { raw: dataFileEl.getAttribute?.('data-filename'), allowStrip: false },
          { raw: dataFileEl.getAttribute?.('data-name'), allowStrip: false }
        );
      }
      const buttons = fileEl.querySelectorAll?.('button[aria-label]') || [];
      for (const btn of buttons) {
        const label = btn.getAttribute?.('aria-label');
        if (label) rawAttrCandidates.push({ raw: label, allowStrip: true });
      }
      rawAttrCandidates.push(
        { raw: fileEl.getAttribute?.('aria-label'), allowStrip: true },
        { raw: fileEl.getAttribute?.('title'), allowStrip: true }
      );
    }

    const visibleLower = visibleName.toLowerCase();
    const visibleHasEllipsis = visibleName.endsWith('...') || visibleName.endsWith('…');
    const visiblePrefix = visibleName.replace(/[.\u2026]+$/, '').toLowerCase();
    let matchedFullAttr = false;
    let fallbackExtCandidate = '';
    let fallbackRawCandidate = '';

    const isVisibleNameMatch = (cand, extMatch) => {
      const baseName = cand.slice(0, extMatch.index).toLowerCase();
      return (
        !visibleName ||
        cand.toLowerCase() === visibleLower ||
        visibleLower === baseName ||
        (baseName.length >= 2 && visibleLower.includes(baseName)) ||
        (visibleHasEllipsis && visiblePrefix.length >= 3 && baseName.startsWith(visiblePrefix))
      );
    };

    for (const entry of rawAttrCandidates) {
      if (!entry || !entry.raw || typeof entry.raw !== 'string') continue;
      const cand = entry.raw.trim();
      if (!cand) continue;
      if (!fallbackRawCandidate) fallbackRawCandidate = cand;

      const variants = [cand];
      if (entry.allowStrip) {
        const stripped = cand
          .replace(/^(?:open|view|preview|download|remove|delete|打开|查看|预览|下载|移除|删除)\s+/i, '')
          .trim();
        if (stripped && stripped !== cand) {
          variants.push(stripped);
        }
      }

      for (const variant of variants) {
        const extMatch = variant.match(/\.([a-zA-Z0-9]{1,10})$/);
        if (extMatch && !/^\d+$/.test(extMatch[1])) {
          if (!fallbackExtCandidate) {
            fallbackExtCandidate = variant;
          }
          if (isVisibleNameMatch(variant, extMatch)) {
            fullFileName = variant;
            resolvedName = variant;
            matchedFullAttr = true;
            break;
          }
        }
      }
      if (matchedFullAttr) break;
    }

    if (!matchedFullAttr && fallbackExtCandidate) {
      fullFileName = fallbackExtCandidate;
    } else if (!fullFileName && fallbackRawCandidate) {
      fullFileName = fallbackRawCandidate;
    }

    let fileType = 'File';
    let ext = '';
    const extMatch = fullFileName.match(/\.([a-zA-Z0-9]{1,10})$/);
    if (isFolder) {
      fileType = 'Folder';
    } else if (extMatch && !/^\d+$/.test(extMatch[1])) {
      ext = extMatch[1].toUpperCase();
      fileType = ext;
    } else if (fileEl) {
      const iconImg = fileEl.querySelector?.('img[alt*="icon" i]');
      if (iconImg && iconImg.alt) {
        const altLower = iconImg.alt.toLowerCase();
        if (altLower.includes('google docs') || altLower.includes('docs icon')) {
          fileType = 'DOC';
          ext = 'DOC';
        } else if (altLower.includes('google sheets') || altLower.includes('sheets icon')) {
          fileType = 'SHEET';
          ext = 'SHEET';
        } else if (altLower.includes('google slides') || altLower.includes('slides icon')) {
          fileType = 'SLIDE';
          ext = 'SLIDE';
        } else {
          const altType = iconImg.alt.replace(/icon/i, '').trim().toUpperCase();
          if (altType.length > 0 && altType.length <= 5) {
            fileType = altType;
            ext = altType;
          }
        }
      }
    }

    // Strip redundant leading type badge (e.g. "PDF attention_is_all_you_need") only when separated by whitespace
    if (!matchedFullAttr && !labelText && ext && resolvedName && fileEl && typeof fileEl.querySelectorAll === 'function') {
      const upperResolved = resolvedName.toUpperCase();
      if (upperResolved.startsWith(ext) && /^\s+/.test(resolvedName.slice(ext.length))) {
        const remainder = resolvedName.slice(ext.length).trim();
        if (remainder) {
          const allChildren = Array.from(fileEl.querySelectorAll('*') || []);
          const hasBadgeChild = allChildren.some(
            (child) => (!child.children || child.children.length === 0) && (child.textContent || '').trim().toUpperCase() === ext
          );
          if (hasBadgeChild) {
            resolvedName = remainder;
          }
        }
      }
    }

    const fileCategory = this.detectFileCategory(fileType, fullFileName, isFolder);

    return {
      visibleName,
      fileName: resolvedName || visibleName,
      fullFileName,
      fileType,
      ext,
      isFolder,
      fileCategory
    };
  },

  // Check whether an element contains folder icon or class indicators
  _hasFolderIndicator: function (el) {
    if (!el) return false;
    const matIcons = el.querySelectorAll ? Array.from(el.querySelectorAll('mat-icon') || []) : [];
    const hasFolderMatIcon = matIcons.some((m) => {
      const iconText = `${m.textContent || ''} ${m.getAttribute?.('fontIcon') || ''} ${m.getAttribute?.('data-mat-icon-name') || ''}`.toLowerCase();
      return iconText.includes('folder');
    });
    return Boolean(
      hasFolderMatIcon ||
      el.matches?.('[class*="folder"]') ||
      el.querySelector?.('[aria-label*="folder" i]') !== null ||
      el.querySelector?.('[class*="folder"]') !== null ||
      el.querySelector?.('img[alt*="folder" i]') !== null
    );
  },

  // Return normalized selector strings for attachment extraction
  _getAttachmentSelectors: function () {
    const selectors = GemiBoost.Config?.SELECTORS || {};
    return {
      fileCard: selectors.FILE_CARD || '[data-test-id="uploaded-file"], .new-file-preview-container',
      explicitQuoteCard: selectors.EXPLICIT_QUOTE_CARD || '.submitted-quote-container, .submitted-quote-in-query, .quote-preview-container, .citation-preview',
      fileContainer: selectors.FILE_CONTAINER || '.file-preview-container, [class*="file-preview"], [data-test-id*="file-preview"], [data-test-id="uploaded-file"]',
      quoteContainer: selectors.QUOTE_CONTAINER || '',
      hiddenLabel: selectors.HIDDEN_LABEL || '.cdk-visually-hidden, [class*="visually-hidden"]'
    };
  },

  // Extract visible text from an element while omitting visually-hidden nodes and optional noise selectors
  _getElementTextWithoutHidden: function (el, extraStripSelector = '') {
    if (!el) return '';
    const { hiddenLabel } = this._getAttachmentSelectors();
    if (typeof el.cloneNode === 'function') {
      const clone = el.cloneNode(true);
      const stripSel = [hiddenLabel, extraStripSelector].filter(Boolean).join(', ');
      if (stripSel && typeof clone.querySelectorAll === 'function') {
        clone.querySelectorAll(stripSel).forEach((node) => node.remove());
      }
      return (clone.textContent || '').trim();
    }
    return (el.textContent || '').trim();
  },

  // Check whether an <img> element is a candidate user-uploaded image (excluding avatars, UI/file icons, and hidden nodes)
  _isUploadedImageCandidate: function (img) {
    if (!img) return false;
    const { hiddenLabel } = this._getAttachmentSelectors();
    if (
      img.classList?.contains('user-icon') ||
      img.classList?.contains('avatar') ||
      img.classList?.contains('luminous-file-icon') ||
      img.getAttribute?.('data-test-id') === 'luminous-file-icon' ||
      img.getAttribute?.('aria-hidden') === 'true' ||
      (hiddenLabel && img.closest?.(hiddenLabel)) ||
      img.closest?.('[data-test-id="luminous-file-icon"], .luminous-file-icon')
    ) {
      return false;
    }

    const src = img.currentSrc || img.src || img.getAttribute?.('src') || '';
    if (src && (src.includes('googleusercontent.com/a/') || src.includes('gstatic.com'))) {
      return false;
    }

    const alt = (img.getAttribute?.('alt') || img.alt || '').trim();
    if (alt && /\bicon$/i.test(alt) && !/\.[a-zA-Z0-9]{2,5}$/i.test(alt)) {
      return false;
    }

    return true;
  },

  // Check whether an extension string corresponds to an image format
  _isImageExtension: function (ext) {
    return /^(?:png|jpe?g|gif|webp|bmp|svg|ico|tiff?|heic|heif|avif|jfif|dng|raw|psd)$/i.test(ext || '');
  },

  // Detect pure image preview containers already handled by getValidImages so they are never duplicated as file rows
  isPureImagePreviewElement: function (el) {
    if (!el) return false;
    const { fileCard, explicitQuoteCard } = this._getAttachmentSelectors();

    if (
      el.matches?.(`${fileCard}, .new-file-preview-file`) ||
      el.querySelector?.(`${fileCard}, .new-file-preview-file, [data-test-id="filename-label"], .filename-label, [data-test-id="luminous-file-icon"], .luminous-file-icon`)
    ) {
      return false;
    }

    if (
      el.matches?.(explicitQuoteCard) ||
      el.querySelector?.(`${explicitQuoteCard}, gem-icon.submitted-quote-icon, gem-icon[class*="quote" i], blockquote`) ||
      el.querySelector?.('video, audio') ||
      this._hasFolderIndicator(el)
    ) {
      return false;
    }

    const hasExplicitPreviewImg = Boolean(
      el.matches?.('button.preview-image-button, [data-test-id="uploaded-img"], img.preview-image') ||
      el.querySelector?.('img[data-test-id="uploaded-img"], img.preview-image, button.preview-image-button')
    );
    const candidateImgs = el.querySelectorAll
      ? Array.from(el.querySelectorAll('img')).filter((img) => this._isUploadedImageCandidate(img))
      : [];
    if (!hasExplicitPreviewImg && candidateImgs.length === 0) {
      return false;
    }

    // Reject if any button label advertises a non-image file extension
    const buttons = el.querySelectorAll?.('button[aria-label]') || [];
    for (const btn of buttons) {
      const label = (btn.getAttribute?.('aria-label') || '').trim();
      const cleaned = label
        .replace(/^(?:open|view|preview|download|remove|delete|show|打开|查看|预览|下载|移除|删除)\s+/i, '')
        .trim();
      const extMatch = cleaned.match(/\.([a-zA-Z0-9]{1,10})$/);
      if (
        extMatch &&
        !/^\d+$/.test(extMatch[1]) &&
        !this._isImageExtension(extMatch[1]) &&
        !/^https?:\/\//i.test(cleaned) &&
        !/\s.*\.(?:com|org|net|edu|gov)$/i.test(cleaned)
      ) {
        return false;
      }
    }

    const nonButtonText = this._getElementTextWithoutHidden(el, 'button, mat-icon, gem-icon, svg');
    if (!nonButtonText || this.isPlaceholderImageLabel(nonButtonText)) {
      return true;
    }

    const textExtMatch = nonButtonText.match(/\.([a-zA-Z0-9]{1,10})$/m);
    if (textExtMatch && !/^\d+$/.test(textExtMatch[1])) {
      return this._isImageExtension(textExtMatch[1]);
    }

    return false;
  },

  // Check whether an element represents a standalone file or quote card (rather than an icon/action sub-part)
  _isStandaloneAttachmentCard: function (el) {
    if (!el || this.isPureImagePreviewElement(el)) return false;
    const { fileCard, explicitQuoteCard } = this._getAttachmentSelectors();
    if (el.matches?.(fileCard) || el.matches?.(explicitQuoteCard)) return true;

    const cleanText = this._getElementTextWithoutHidden(el);
    if (!cleanText && !el.querySelector?.('video, audio')) return false;
    if (el.matches?.('button, mat-icon, gem-icon, svg, img')) return false;

    const nonActionText = this._getElementTextWithoutHidden(el, 'button, mat-icon, gem-icon, svg, img');
    const hasMetadataAttr = Boolean(
      el.querySelector?.('[data-test-id="filename-label"], .filename-label, [data-filename], [data-name], video, audio') ||
      el.getAttribute?.('data-filename') ||
      el.getAttribute?.('data-name')
    );

    // Reject action-only button wrappers (e.g. a Download/Remove button container)
    if (!nonActionText && !hasMetadataAttr) {
      const btns = Array.from(el.querySelectorAll?.('button[aria-label]') || []);
      const hasCardButton = btns.some((btn) => {
        const label = (btn.getAttribute?.('aria-label') || '').trim();
        if (!label) return false;
        const isActionOnly = /^(?:open|view|preview|download|remove|delete|close|clear|打开|查看|预览|下载|移除|删除|关闭)\b/i.test(label);
        if (isActionOnly) return false;
        return /\.[a-zA-Z0-9]{1,10}$/.test(label);
      });
      if (!hasCardButton) return false;
    }

    if (
      hasMetadataAttr ||
      el.matches?.('.file-preview-container, user-query-file-preview, .query-file-preview, [data-test-id*="file-preview"], [data-test-id*="attachment"]') ||
      this._hasFolderIndicator(el)
    ) {
      return true;
    }

    if (/\.[a-zA-Z0-9]{1,10}$/m.test(cleanText)) {
      return true;
    }

    // Only treat nested elements as standalone quote cards via explicit quote indicators (never Rule 7 fallback on file sub-parts)
    return Boolean(
      el.matches?.('[class*="quote"], [class*="citation"], [data-test-id*="quote"], [data-test-id*="citation"], blockquote') ||
      el.querySelector?.(`${explicitQuoteCard}, gem-icon.submitted-quote-icon, gem-icon[class*="quote" i], blockquote`) ||
      /^[↪↳↵⤷↩⮑⮡➜➔→]/.test(cleanText)
    );
  },

  // Resolve ordered individual file and quote attachment card elements within a prompt node
  getFileAndQuoteElements: function (promptEl) {
    if (!promptEl || typeof promptEl.querySelectorAll !== 'function') return [];

    const { fileCard, explicitQuoteCard, fileContainer, quoteContainer, hiddenLabel } = this._getAttachmentSelectors();
    const queryParts = [
      fileContainer,
      fileCard,
      quoteContainer,
      'user-query-file-preview',
      '.query-file-preview',
      '[data-test-id*="file-preview"]',
      '[data-test-id*="attachment"]'
    ].filter(Boolean);

    const rawMatched = Array.from(promptEl.querySelectorAll(queryParts.join(', '))).filter((el) => {
      if (!el) return false;
      if (hiddenLabel && el.closest?.(hiddenLabel)) return false;
      return true;
    });
    if (rawMatched.length === 0) return [];

    const carouselOrSlotSel = 'user-query-file-carousel, .query-file-carousel, user-query-file-preview, .query-file-preview';
    const explicitSingleSel = [fileCard, explicitQuoteCard].filter(Boolean).join(', ');

    const resolveNode = (el) => {
      if (el.matches?.(fileCard)) return [el];
      if (explicitQuoteCard && el.matches?.(explicitQuoteCard) && !el.querySelector?.(explicitSingleSel)) {
        return [el];
      }

      const descendants = rawMatched.filter((other) => other !== el && el.contains(other));
      if (descendants.length === 0) return [el];

      const directChildren = descendants.filter(
        (d) => !descendants.some((other) => other !== d && other.contains(d))
      );
      const resolvedChildren = directChildren.flatMap(resolveNode);

      const hasExplicitDescendant = Boolean(el.querySelector?.(explicitSingleSel));
      const isCarouselContainer = Boolean(
        el.matches?.('user-query-file-carousel, .query-file-carousel') ||
        el.querySelector?.('user-query-file-carousel, .query-file-carousel') ||
        (!el.matches?.('user-query-file-preview, .query-file-preview') && el.querySelector?.('user-query-file-preview, .query-file-preview'))
      );
      if (hasExplicitDescendant || isCarouselContainer) {
        return resolvedChildren;
      }

      const standaloneChildren = resolvedChildren.filter((c) => this._isStandaloneAttachmentCard(c));
      if (standaloneChildren.length >= 2) {
        return standaloneChildren;
      }

      // Unwrap mixed non-carousel container holding both a separate uploaded image and standalone file/quote card
      if (standaloneChildren.length >= 1 && el.querySelectorAll) {
        const hasSeparateImg = Array.from(el.querySelectorAll('img')).some(
          (img) => this._isUploadedImageCandidate(img) && !standaloneChildren.some((sc) => sc.contains(img))
        );
        if (hasSeparateImg) {
          return standaloneChildren;
        }
      }

      // If this element is a non-card wrapper around a single standalone child (e.g. a carousel slot without FILE_CARD)
      if (el.matches?.(carouselOrSlotSel) && standaloneChildren.length === 1) {
        return standaloneChildren;
      }

      return [el];
    };

    const topRoots = rawMatched.filter(
      (el) => !rawMatched.some((other) => other !== el && other.contains(el))
    );

    const uniqueResolved = [];
    const seenEls = new Set();
    topRoots.forEach((root) => {
      resolveNode(root).forEach((resolvedEl) => {
        if (resolvedEl && !seenEls.has(resolvedEl)) {
          seenEls.add(resolvedEl);
          uniqueResolved.push(resolvedEl);
        }
      });
    });

    return uniqueResolved.filter((el) => {
      const cleanText = this._getElementTextWithoutHidden(el);
      if (!cleanText && !el.querySelector?.('video, audio')) return false;
      if (this.isPureImagePreviewElement(el)) return false;
      return true;
    });
  },

  // Resolve ordered valid user-uploaded <img> elements within a prompt node
  getValidImages: function (promptEl, resolvedFileEls) {
    if (!promptEl || typeof promptEl.querySelectorAll !== 'function') return [];
    const { fileCard } = this._getAttachmentSelectors();
    const fileEls = Array.isArray(resolvedFileEls) ? resolvedFileEls : this.getFileAndQuoteElements(promptEl);

    return Array.from(promptEl.querySelectorAll('img')).filter((img) => {
      if (!this._isUploadedImageCandidate(img)) return false;
      if (img.closest?.(`${fileCard}, .new-file-preview-file`)) return false;
      if (fileEls.some((fileEl) => fileEl && (fileEl === img || fileEl.contains?.(img)))) {
        return false;
      }
      return true;
    });
  },

  // Extract structured prompt data items from the current live DOM for TOC navigation
  extractFromDOM: function () {
    const userPrompts = document.querySelectorAll(GemiBoost.Config.SELECTORS.USER_QUERY);
    if (userPrompts.length === 0) return [];

    const extractedData = [];

    userPrompts.forEach((promptEl, index) => {
      // Stamp deterministic index onto DOM node for O(1) query identification
      promptEl.dataset.gbQueryIndex = String(index);

      // 1. Text extraction using textContent to prevent empty string from off-screen / content-visibility
      const rawText = this.getCleanPromptText(promptEl);

      // 2. Extract independent files/quotes and images via shared resolvers (1-to-1 with navigation targets)
      const topLevelFiles = this.getFileAndQuoteElements(promptEl);
      const validImages = this.getValidImages(promptEl, topLevelFiles);
      let text = this.getPromptTextWithoutAttachments(promptEl, topLevelFiles);
      let hasQuote = false;
      const fileInfoList = [];

      topLevelFiles.forEach((file, fileIndex) => {
        const fileText = file.textContent ? file.textContent.trim() : '';

        // Check if container represents a quoted text selection (Ask Gemini)
        const isQuote = fileText ? this.isQuoteElement(file, fileText) : false;
        if (isQuote) {
          hasQuote = true;
          const cleanQuote = this.extractCleanQuoteText(file) || fileText.replace(/^[↪↳↵⤷↩⮑⮡➜➔→"“'「『«\s]+/, '').replace(/\s+/g, ' ').trim();
          fileInfoList.push({
            fileName: cleanQuote,
            fileType: 'Quote',
            fileCategory: 'quote',
            subIndex: fileIndex,
            isQuote: true
          });
          return;
        }

        if (!fileText && file.querySelector?.('video, audio')) {
          const isAudioOnly = Boolean(file.querySelector('audio') && !file.querySelector('video'));
          fileInfoList.push({
            fileName: isAudioOnly ? 'Audio File' : 'Video File',
            fileType: isAudioOnly ? 'Audio' : 'Video',
            fileCategory: isAudioOnly ? 'audio' : 'video',
            subIndex: fileIndex
          });
          return;
        }

        const fMeta = this.extractFileInfo(file, fileText);
        fileInfoList.push({
          fileName: fMeta.fileName,
          fileType: fMeta.fileType,
          fileCategory: fMeta.fileCategory,
          subIndex: fileIndex
        });
      });

      if (hasQuote && text) {
        text = text.replace(/^[↪↳↵⤷↩⮑⮡➜➔→]+\s*/, '').trim();
      }

      const hasImages = validImages.length > 0;
      const hasFiles = fileInfoList.length > 0;

      // 4. Construct items according to turn structure:
      // - One turn sequence badge per turn
      // - Each attachment gets its own line
      // - If turn has text, text is turn root
      // - If turn has NO text, the first attachment is the turn root
      // - Same horizontal indentation across all items
      if (text) {
        // A. Turn has text: text row is turn root
        const textPreview = text.length > 50 ? text.substring(0, 50) + '...' : text;
        extractedData.push({
          type: 'text',
          isTurnRoot: true,
          display: textPreview,
          title: text,
          className: 'gemiboost-toc-item',
          queryIndex: index,
          rawText: rawText
        });

        // Attachments become subsequent rows in the same turn
        validImages.forEach((img, imgIdx) => {
          const imgInfo = this.extractImageInfo(img, imgIdx, validImages.length);
          extractedData.push({
            type: 'image',
            fileCategory: 'image',
            isTurnRoot: false,
            fileType: imgInfo.fileType,
            fileName: imgInfo.fileName,
            display: imgInfo.display,
            title: imgInfo.fileName || imgInfo.display,
            isDefaultName: imgInfo.isDefaultName,
            imageIndex: imgInfo.imageIndex,
            totalImages: imgInfo.totalImages,
            className: 'gemiboost-toc-item gemiboost-toc-attachment',
            queryIndex: index,
            subIndex: imgIdx,
            rawText: rawText
          });
        });

        fileInfoList.forEach((fInfo) => {
          const displayLabel = `[${fInfo.fileType}] ${fInfo.fileName}`;
          extractedData.push({
            type: 'file',
            fileCategory: fInfo.fileCategory,
            isTurnRoot: false,
            fileType: fInfo.fileType,
            fileName: fInfo.fileName,
            display: displayLabel,
            title: fInfo.fileName,
            className: 'gemiboost-toc-item gemiboost-toc-attachment',
            queryIndex: index,
            subIndex: fInfo.subIndex,
            rawText: rawText
          });
        });
      } else if (hasImages) {
        // B. Turn is pure attachments starting with images (no text)
        validImages.forEach((img, imgIdx) => {
          const imgInfo = this.extractImageInfo(img, imgIdx, validImages.length);
          extractedData.push({
            type: 'image',
            fileCategory: 'image',
            isTurnRoot: imgIdx === 0, // only first image is turn root
            fileType: imgInfo.fileType,
            fileName: imgInfo.fileName,
            display: imgInfo.display,
            title: imgInfo.fileName || imgInfo.display,
            isDefaultName: imgInfo.isDefaultName,
            imageIndex: imgInfo.imageIndex,
            totalImages: imgInfo.totalImages,
            className: imgIdx === 0
              ? 'gemiboost-toc-item'
              : 'gemiboost-toc-item gemiboost-toc-attachment',
            queryIndex: index,
            subIndex: imgIdx,
            rawText: rawText
          });
        });

        fileInfoList.forEach((fInfo) => {
          const displayLabel = `[${fInfo.fileType}] ${fInfo.fileName}`;
          extractedData.push({
            type: 'file',
            fileCategory: fInfo.fileCategory,
            isTurnRoot: false,
            fileType: fInfo.fileType,
            fileName: fInfo.fileName,
            display: displayLabel,
            title: fInfo.fileName,
            className: 'gemiboost-toc-item gemiboost-toc-attachment',
            queryIndex: index,
            subIndex: fInfo.subIndex,
            rawText: rawText
          });
        });
      } else if (hasFiles) {
        // C. Turn is pure file(s) (no text, no images)
        fileInfoList.forEach((fInfo, fIdx) => {
          const displayLabel = `[${fInfo.fileType}] ${fInfo.fileName}`;
          extractedData.push({
            type: 'file',
            fileCategory: fInfo.fileCategory,
            isTurnRoot: fIdx === 0, // only first file is turn root
            fileType: fInfo.fileType,
            fileName: fInfo.fileName,
            display: displayLabel,
            title: fInfo.fileName,
            className: fIdx === 0
              ? 'gemiboost-toc-item'
              : 'gemiboost-toc-item gemiboost-toc-attachment',
            queryIndex: index,
            subIndex: fInfo.subIndex,
            rawText: rawText
          });
        });
      } else {
        // D. Empty fallback
        extractedData.push({
          type: 'empty',
          isTurnRoot: true,
          display: '[Empty]',
          title: '',
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

  // Extract clean image info, resolving true filename if present, or human-friendly label
  extractImageInfo: function (img, imgIdx, totalImages) {
    const isPlaceholder = (val) => this.isPlaceholderImageLabel(val);

    // 1. Check explicit filename attributes and intercepted RPC metadata (without stripping name prefixes)
    let realName = '';
    const imgSrc = img.currentSrc || img.src || (img.getAttribute && img.getAttribute('src')) || '';
    const interceptedName = this.lookupImageFilename(imgSrc);
    const directCandidates = [
      img.getAttribute('data-filename'),
      img.getAttribute('data-name'),
      interceptedName
    ];

    const rawContainer = img.closest(
      '.file-preview-container, [class*="file-preview"], [class*="image-preview"], [class*="preview"], [role="group"]'
    );
    let scopedContainer = rawContainer;
    if (rawContainer && typeof rawContainer.querySelectorAll === 'function') {
      const { fileCard } = this._getAttachmentSelectors();
      const groupImgs = rawContainer.querySelectorAll('img');
      const hasSharedAttachmentWrapper = Boolean(
        rawContainer.querySelector(
          `${fileCard}, .new-file-preview-file, user-query-file-carousel, .query-file-carousel, [data-test-id="filename-label"], .filename-label`
        ) ||
        rawContainer.querySelectorAll('user-query-file-preview, .query-file-preview').length > 1
      );
      if ((groupImgs && groupImgs.length > 1) || hasSharedAttachmentWrapper) {
        const tightWrapper = img.closest(
          '.image-preview, [class*="image-preview"], [class*="thumbnail"], [data-test-id*="image"], button.preview-image-button, user-query-file-preview'
        );
        const resolvedTight = tightWrapper === img ? img.parentElement : tightWrapper;
        if (
          resolvedTight &&
          (!resolvedTight.querySelectorAll || resolvedTight.querySelectorAll('img').length <= 1) &&
          !resolvedTight.querySelector?.(`${fileCard}, .new-file-preview-file`)
        ) {
          scopedContainer = resolvedTight;
        } else {
          scopedContainer = null;
        }
      }
    }

    if (scopedContainer) {
      directCandidates.push(
        scopedContainer.getAttribute('data-filename'),
        scopedContainer.getAttribute('data-name')
      );
    }

    for (const cand of directCandidates) {
      if (cand && !isPlaceholder(cand)) {
        realName = cand.trim();
        break;
      }
    }

    // 2. Fallback to heuristic DOM title/alt/aria-label attributes
    if (!realName) {
      const heuristicCandidates = [img.title, img.alt];

      if (scopedContainer) {
        heuristicCandidates.push(
          scopedContainer.title,
          scopedContainer.getAttribute('aria-label')
        );

        // Check buttons inside scoped single-image container
        const btns = scopedContainer.querySelectorAll('button[aria-label]');
        for (const btn of btns) {
          const btnLabel = btn.getAttribute('aria-label');
          if (btnLabel && !isPlaceholder(btnLabel)) {
            const stripped = btnLabel.replace(/^(?:remove|delete|view|open|preview|download|show|移除|删除|查看|打开|预览|下载)\s+/i, '').trim();
            if (stripped && !isPlaceholder(stripped)) {
              const extMatch = stripped.match(/([^\/\\:*\?"<>|]+\.[a-zA-Z0-9]{2,5})$/);
              if (extMatch) heuristicCandidates.push(extMatch[1]);
              else heuristicCandidates.push(stripped);
            }
          }
        }
      }

      for (const cand of heuristicCandidates) {
        if (cand && !isPlaceholder(cand)) {
          const cleaned = cand.replace(/^(?:remove|delete|view|open|preview|download|移除|删除|查看|打开|预览|下载)\s+/i, '').trim();
          if (cleaned && !isPlaceholder(cleaned)) {
            realName = cleaned;
            break;
          }
        }
      }
    }

    // Determine extension and tag
    let fileType = 'IMG';
    if (realName) {
      const extMatch = realName.match(/\.([a-zA-Z0-9]+)$/);
      if (extMatch) {
        fileType = extMatch[1].toUpperCase();
      }
    }

    const isDefaultName = !realName;
    const isChinese = (typeof document !== 'undefined' && document.documentElement?.lang?.toLowerCase().startsWith('zh')) ||
      (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh'));
    const defaultWord = isChinese ? '图片' : 'Image';
    const baseLabel = totalImages > 1 ? `${defaultWord} ${imgIdx + 1}` : defaultWord;
    const displayLabel = realName ? `[${fileType}] ${realName}` : `[IMG] ${baseLabel}`;

    return {
      fileName: realName || (totalImages > 1 ? `Image ${imgIdx + 1}` : 'Image'),
      fileType: fileType,
      fileCategory: 'image',
      display: displayLabel,
      isDefaultName: isDefaultName,
      imageIndex: imgIdx,
      totalImages: totalImages
    };
  },

  // Classify file type into one of 10 granular categories (or fallback 'file')
  detectFileCategory: function (fileType, fileName, isFolder, isQuote) {
    if (isQuote || (fileType && fileType.toLowerCase() === 'quote')) {
      return 'quote';
    }

    if (isFolder || (fileType && fileType.toLowerCase() === 'folder')) {
      return 'folder';
    }

    const ext = (fileType || '').toLowerCase();
    const name = (fileName || '').toLowerCase();

    if (ext === 'pdf' || name.endsWith('.pdf')) {
      return 'pdf';
    }

    const codeExts = [
      'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass',
      'json', 'yaml', 'yml', 'xml', 'sql', 'sh', 'bash', 'zsh', 'c', 'cpp',
      'cc', 'cxx', 'h', 'hpp', 'java', 'go', 'rs', 'php', 'rb', 'swift',
      'kt', 'kts', 'dart', 'scala', 'r', 'lua', 'vue', 'svelte'
    ];
    if (codeExts.includes(ext) || codeExts.some((ce) => name.endsWith('.' + ce))) {
      return 'code';
    }

    const tableExts = ['csv', 'xlsx', 'xls', 'tsv', 'parquet', 'feather', 'ods'];
    if (tableExts.includes(ext) || tableExts.some((te) => name.endsWith('.' + te))) {
      return 'table';
    }

    const textExts = ['md', 'markdown', 'txt', 'rtf', 'log', 'doc', 'docx', 'odt', 'tex'];
    if (textExts.includes(ext) || textExts.some((te) => name.endsWith('.' + te))) {
      return 'text';
    }

    const audioExts = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'];
    if (audioExts.includes(ext) || audioExts.some((ae) => name.endsWith('.' + ae)) || ext === 'audio') {
      return 'audio';
    }

    const videoExts = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv'];
    if (videoExts.includes(ext) || videoExts.some((ve) => name.endsWith('.' + ve)) || ext === 'video' || ext === 'youtube') {
      return 'video';
    }

    const archiveExts = ['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'];
    if (archiveExts.includes(ext) || archiveExts.some((ae) => name.endsWith('.' + ae))) {
      return 'archive';
    }

    const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'tiff'];
    if (imageExts.includes(ext) || imageExts.some((ie) => name.endsWith('.' + ie)) || ext === 'image') {
      return 'image';
    }

    return 'file';
  },

  // Detect whether a container represents a quoted text selection (Ask Gemini)
  isQuoteElement: function (fileEl, fileText) {
    if (!fileEl) return false;
    const text = fileText || fileEl.textContent || '';
    const cleanText = text.trim();

    // 0. Explicit Luminous file cards and uploaded image previews are never quotes
    if (
      fileEl.matches?.('[data-test-id="uploaded-file"], .new-file-preview-container, .new-file-preview-file') ||
      fileEl.querySelector?.('[data-test-id="uploaded-file"], [data-test-id="filename-label"], [data-test-id="luminous-file-icon"], .new-file-preview-file, [data-test-id="uploaded-img"], .preview-image')
    ) {
      return false;
    }

    // 1. Explicit quote wrappers, material/gem quote icons, and leading quote arrows
    if (
      fileEl.matches?.('.submitted-quote-container, .submitted-quote-in-query, [class*="submitted-quote"], .quote-preview-container, [class*="quote-preview"]') ||
      fileEl.querySelector?.('.submitted-quote-container, .submitted-quote-in-query, [class*="submitted-quote"], .quote-preview-container, [class*="quote-preview"], gem-icon.submitted-quote-icon, gem-icon[class*="quote" i]')
    ) {
      return true;
    }

    const quoteIconNames = [
      'prompt_suggestion', 'submitted-quote-icon',
      'subdirectory_arrow_right', 'reply', 'reply_all', 'format_quote', 'quote',
      'turn_right', 'turn_slight_right', 'curved_arrow', 'forward', 'shortcut',
      'call_missed', 'call_missed_outgoing', 'arrow_right_alt', 'east',
      'keyboard_return', 'chat_paste_go'
    ];

    const iconEls = fileEl.querySelectorAll?.(
      'gem-icon, mat-icon, .material-icons, .material-symbols-outlined, [class*="mat-icon"], svg'
    );
    let hasCurvedSvgArrow = false;
    if (iconEls && iconEls.length > 0) {
      for (const iconEl of iconEls) {
        // Exclude close/delete action buttons
        if (iconEl.closest('button[aria-label*="close" i], button[aria-label*="remove" i], button[aria-label*="delete" i], button[aria-label*="关闭" i], button[aria-label*="删除" i]')) {
          continue;
        }

        const textName = (iconEl.textContent || '').trim().toLowerCase();
        const fontIcon = ((iconEl.getAttribute && iconEl.getAttribute('fontIcon')) || '').toLowerCase();
        const svgIcon = ((iconEl.getAttribute && iconEl.getAttribute('svgIcon')) || '').toLowerCase();
        const matName = ((iconEl.getAttribute && iconEl.getAttribute('data-mat-icon-name')) || '').toLowerCase();
        const dataIcon = ((iconEl.getAttribute && iconEl.getAttribute('data-icon')) || '').toLowerCase();
        const ariaLabel = ((iconEl.getAttribute && iconEl.getAttribute('aria-label')) || '').toLowerCase();
        const className = (typeof iconEl.className === 'string' ? iconEl.className : (iconEl.getAttribute && iconEl.getAttribute('class')) || '').toLowerCase();

        const combinedIconInfo = `${textName} ${fontIcon} ${svgIcon} ${matName} ${dataIcon} ${ariaLabel} ${className}`;
        if (quoteIconNames.some((name) => combinedIconInfo.includes(name))) {
          return true;
        }

        // Record SVG curved/hook arrow path as fallback (after filename guard, since CSV/PDF SVGs also contain 'C')
        if (iconEl.tagName && iconEl.tagName.toLowerCase() === 'svg') {
          const pathEl = iconEl.querySelector('path');
          const pathD = pathEl ? (pathEl.getAttribute('d') || '') : '';
          if (
            pathD.includes('C') ||
            pathD.includes('M9.5') ||
            pathD.includes('M6 5') ||
            pathD.includes('15.5 11') ||
            pathD.includes('19 15')
          ) {
            hasCurvedSvgArrow = true;
          }
        }
      }
    }

    // 2. Leading quote arrow symbol check (↪ \u21AA, ↳ \u21B3, ↵ \u21B5, ⤷ \u2937, ↩ \u21A9, ⮑ \u2B91, etc.)
    if (
      /^[↪↳↵⤷↩⮑⮡➜➔→]/i.test(cleanText) ||
      cleanText.includes('↪') ||
      cleanText.includes('↳') ||
      cleanText.includes('⤷')
    ) {
      return true;
    }

    // 3. Button filename guard to prevent real files (including SVGs with 'C' paths or names containing "quote") from matching generic quote rules
    const btns = fileEl.querySelectorAll?.('button[aria-label]') || [];
    for (const btn of btns) {
      const label = (btn.getAttribute?.('aria-label') || '').trim();
      const cleanedLabel = label
        .replace(/^(?:open|view|preview|download|remove|delete|打开|查看|预览|下载|移除|删除)\s+/i, '')
        .trim();
      const extMatch = cleanedLabel.match(/\.([a-zA-Z0-9]{1,10})$/);
      if (
        extMatch &&
        !/^\d+$/.test(extMatch[1]) &&
        cleanedLabel.length <= 150 &&
        !/^https?:\/\//i.test(cleanedLabel) &&
        !/\s.*\.(?:com|org|net|edu|gov)$/i.test(cleanedLabel) &&
        /^[^\/\\:*?"<>|\r\n]+\.[a-zA-Z0-9]{1,10}$/.test(cleanedLabel)
      ) {
        return false;
      }
    }

    if (hasCurvedSvgArrow) {
      return true;
    }

    // 5. Generic configured quote/citation selector match
    if (GemiBoost.Config?.SELECTORS?.QUOTE_CONTAINER) {
      if (fileEl.matches?.(GemiBoost.Config.SELECTORS.QUOTE_CONTAINER)) {
        return true;
      }
      if (fileEl.querySelector?.(GemiBoost.Config.SELECTORS.QUOTE_CONTAINER)) {
        return true;
      }
    }
    if (
      fileEl.closest?.('[class*="quote"], [class*="citation"], [data-test-id*="quote"]') ||
      fileEl.matches?.('[class*="quote"], [class*="citation"], [data-test-id*="quote"]') ||
      fileEl.querySelector?.('blockquote')
    ) {
      return true;
    }

    // 6. Attribute / aria-label check on container or descendant elements
    const aria = ((fileEl.getAttribute && fileEl.getAttribute('aria-label')) || '').toLowerCase();
    if (
      aria.includes('quote') || aria.includes('citation') || aria.includes('selected') || aria.includes('引用')
    ) {
      return true;
    }
    const labeledDescendant = fileEl.querySelector?.(
      '[aria-label*="quote" i], [aria-label*="citation" i], [aria-label*="selected" i], [aria-label*="引用" i], [title*="quote" i], [title*="引用" i]'
    );
    if (labeledDescendant) {
      return true;
    }

    // 7. Heuristic check: no filename extension at line end, not folder/media/file-size/file-icon
    const endExtMatch = cleanText.match(/\.([a-zA-Z0-9]{1,10})$/m);
    const hasExtension = Boolean(endExtMatch && !/^\d+$/.test(endExtMatch[1]));
    const isFolder = this._hasFolderIndicator(fileEl);
    const isMedia = fileEl.querySelector?.('video, audio, img') !== null;
    const isKnownExtensionlessFile = /^(dockerfile|makefile|license|readme|gemfile|procfile|vagrantfile|jenkinsfile)$/i.test(cleanText.trim());
    const hasFileSize = /\b\d+(\.\d+)?\s*(b|kb|mb|gb|tb|bytes|字节|千字节|兆字节)\b/i.test(cleanText);
    const hasFileDocIcon = Boolean(
      fileEl.querySelector?.(
        'mat-icon[fontIcon*="file" i], mat-icon[fontIcon*="description" i], [class*="file-icon"], [class*="doc-icon"], img[alt*="icon" i]'
      ) ||
      Array.from(fileEl.querySelectorAll?.('mat-icon') || []).some((m) => {
        const name = `${m.textContent || ''} ${m.getAttribute?.('fontIcon') || ''} ${m.getAttribute?.('data-mat-icon-name') || ''}`.toLowerCase();
        return ['description', 'insert_drive_file', 'draft', 'file_present', 'article', 'attach_file', 'picture_as_pdf', 'text_snippet'].some((n) => name.includes(n));
      })
    );

    if (!hasExtension && !isFolder && !isMedia && !isKnownExtensionlessFile && !hasFileSize && !hasFileDocIcon && cleanText.length > 0) {
      return true;
    }

    return false;
  },

  // Extract and clean raw text from a quote container, stripping UI noise elements
  extractCleanQuoteText: function (fileEl) {
    if (!fileEl) return '';
    try {
      const clone = fileEl.cloneNode(true);
      // Remove noise elements: action buttons, visually-hidden screen reader labels, icons, SVGs
      clone.querySelectorAll(
        'button, .cdk-visually-hidden, [class*="visually-hidden"], gem-icon, mat-icon, .material-icons, .material-symbols-outlined, [class*="mat-icon"], svg'
      ).forEach((el) => el.remove());
      let raw = clone.textContent || '';
      // Strip leading arrow characters, quotation marks, and normalize whitespace
      raw = raw.replace(/^[↪↳↵⤷↩⮑⮡➜➔→"“'「『«\s]+/, '').replace(/[”'」』»\s]+$/, '').replace(/\s+/g, ' ').trim();
      return raw;
    } catch (e) {
      const text = fileEl.textContent || '';
      return text.replace(/^[↪↳↵⤷↩⮑⮡➜➔→"“'「『«\s]+/, '').replace(/[”'」』»\s]+$/, '').replace(/\s+/g, ' ').trim();
    }
  },

  // Extract structured user turn (text content and attached multimodal files)
  extractUserTurn: function (promptEl) {
    // A. Collect image and file/quote attachments via shared DOM resolvers
    const attachments = [];
    const fileElements = this.getFileAndQuoteElements(promptEl);
    const images = this.getValidImages(promptEl, fileElements);

    // B. Images uploaded by user
    images.forEach((img, imgIdx) => {
      const imgInfo = this.extractImageInfo(img, imgIdx, images.length);
      if (!imgInfo.isDefaultName && imgInfo.fileName) {
        attachments.push(`[${imgInfo.fileType || 'Image'}] ${imgInfo.fileName}`);
      } else {
        attachments.push(images.length > 1 ? `[Image ${imgIdx + 1}]` : '[Image]');
      }
    });

    // C. Attached files, documents, and quotes
    let text = this.getPromptTextWithoutAttachments(promptEl, fileElements);
    let hasQuote = false;
    const { fileContainer, fileCard } = this._getAttachmentSelectors();

    fileElements.forEach((fileEl) => {
      const fileText = fileEl.textContent ? fileEl.textContent.trim() : '';

      // Check if container represents a quoted text selection (Ask Gemini)
      if (fileText && this.isQuoteElement(fileEl, fileText)) {
        hasQuote = true;
        const cleanQuote = this.extractCleanQuoteText(fileEl) || fileText.replace(/^[↪↳↵⤷↩⮑⮡➜➔→"“'「『«\s]+/, '').replace(/\s+/g, ' ').trim();
        // Quote represents conversation context, keep full text without 100-char truncation
        attachments.push(`[Quote] ${cleanQuote}`);
        return;
      }

      if (!fileText && fileEl.querySelector?.('video, audio')) {
        const isAudioOnly = Boolean(fileEl.querySelector('audio') && !fileEl.querySelector('video'));
        attachments.push(isAudioOnly ? '[Audio] Audio File' : '[Video] Video File');
        return;
      }

      const fMeta = this.extractFileInfo(fileEl, fileText);
      const lower = fileText.toLowerCase();
      const lowerFull = (fMeta.fullFileName || '').toLowerCase();
      const elHtml = (fileEl.outerHTML || '').toLowerCase();

      const isYouTube =
        lower.includes('youtube') ||
        elHtml.includes('youtube') ||
        elHtml.includes('youtu.be') ||
        /\.(mp4|mov|webm|mkv)($|\s)/i.test(lowerFull);
      const isAudio =
        /\.(mp3|wav|m4a|aac|ogg|flac)($|\s)/i.test(lowerFull) ||
        elHtml.includes('audio') ||
        fileEl.querySelector('audio');
      const isImageFile = /\.(png|jpe?g|gif|webp|bmp|svg)($|\s)/i.test(lowerFull);
      const hasFileExtension = /\.[a-zA-Z0-9]{1,10}($|\s)/.test(lowerFull);

      const fName = fMeta.fileName;
      const ext = fMeta.ext;
      const category = fMeta.fileCategory;

      let attTag = '';
      if (isYouTube) {
        attTag = '[YouTube Video]';
      } else if (category === 'folder') {
        attTag = `[Folder] ${fName || 'Folder'}`;
      } else if (category === 'audio') {
        attTag = `[Audio] ${fName || 'Audio File'}`;
      } else if (category === 'video' || (!isAudio && fileEl.querySelector?.('video'))) {
        attTag = `[Video] ${fName || 'Video File'}`;
      } else if (category === 'pdf') {
        attTag = `[PDF] ${fName}`;
      } else if (category === 'code') {
        attTag = `[${ext || 'Code'}] ${fName}`;
      } else if (category === 'table') {
        attTag = `[${ext || 'Table'}] ${fName}`;
      } else if (category === 'archive') {
        attTag = `[${ext || 'Archive'}] ${fName}`;
      } else if (category === 'text') {
        attTag = `[${ext || 'Text'}] ${fName}`;
      } else if (category === 'image' || isImageFile) {
        if (fName && !this.isPlaceholderImageLabel(fName) && (/\.[a-zA-Z0-9]{2,5}$/.test(fName) || fileEl.matches?.(fileCard))) {
          attTag = `[${ext || 'IMG'}] ${fName}`;
        } else if (images.length === 0) {
          attTag = '[Image]';
        }
      } else if (hasFileExtension || fileEl.matches?.(`${fileContainer}, ${fileCard}`)) {
        if (fName && fName.length < 150) {
          attTag = `[${ext || 'Document'}] ${fName}`;
        }
      }

      if (attTag) {
        attachments.push(attTag);
      }
    });

    if (hasQuote && text) {
      text = text.replace(/^[↪↳↵⤷↩⮑⮡➜➔→]+\s*/, '').trim();
    }

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

    let isChinese = false;
    if (typeof document !== 'undefined' && document.documentElement?.lang) {
      isChinese = document.documentElement.lang.toLowerCase().startsWith('zh');
    } else if (typeof navigator !== 'undefined' && navigator.language) {
      isChinese = navigator.language.toLowerCase().startsWith('zh');
    } else {
      isChinese = /[\u4e00-\u9fa5]/.test(title || '');
    }
    const markdownOptions = { ...settings, isChinese };

    const turns = [];

    userPrompts.forEach((promptEl, index) => {
      // 1. Extract user message and attachments
      const userTurn = this.extractUserTurn(promptEl);

      // 2. Find associated model response
      const modelEl = this.findAssociatedModelResponse(promptEl, index, modelResponses);
      const modelMarkdown = modelEl
        ? (GemiBoost.Markdown ? GemiBoost.Markdown.elementToMarkdown(modelEl, markdownOptions) : modelEl.textContent || '')
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

GemiBoost.Extractor.initImageFilenameBridge();
