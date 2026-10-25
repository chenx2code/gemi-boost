// content-markdown.js
// Specialized DOM-to-Markdown serialization engine for Gemini Web

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Markdown = {
  // Convert an HTML element (or tree) into clean, standard Markdown
  elementToMarkdown: function (rootElement, options = {}) {
    if (!rootElement) return '';

    // Clone element to safely sanitize and isolate without affecting live DOM
    const clone = rootElement.cloneNode(true);
    this.preprocessElement(clone, options);

    const rawMarkdown = this.serializeNode(clone, options);
    return this.postprocessMarkdown(rawMarkdown);
  },

  // Remove UI noise elements (copy buttons, icons, visually-hidden labels) before serialization
  preprocessElement: function (element, options = {}) {
    // Selectors for elements that should not appear in the exported markdown
    const ignoredSelectors = [
      'button',
      '.cdk-visually-hidden',
      '[class*="visually-hidden"]',
      'mat-icon',
      'svg:not(.katex svg)',
      '.copy-button',
      '.code-block-decoration button',
      'share-button',
      '.response-actions',
      '.action-buttons'
    ];

    ignoredSelectors.forEach((sel) => {
      element.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // If includeThinking is false (default), strip all thinking containers before serialization
    if (!options.includeThinking) {
      if (GemiBoost.Config?.SELECTORS?.THINKING_CONTAINER) {
        element.querySelectorAll(GemiBoost.Config.SELECTORS.THINKING_CONTAINER).forEach((el) => el.remove());
      }
    }
  },

  // Recursively serialize a DOM node to Markdown
  serializeNode: function (node, context = {}) {
    if (!node) return '';

    // 1. Text node
    if (node.nodeType === Node.TEXT_NODE) {
      if (context.isCodeBlock) {
        return node.nodeValue;
      }
      return node.nodeValue.replace(/\r\n/g, '\n');
    }

    // 2. Not an element node
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const el = node;
    const tagName = el.tagName.toLowerCase();

    // 3. KaTeX math formulas
    if (el.classList.contains('katex-display') || el.matches?.(GemiBoost.Config.SELECTORS.MATH_DISPLAY)) {
      const tex = this.extractTex(el);
      return tex ? `\n\n$$\n${tex}\n$$\n\n` : '';
    }

    if (el.classList.contains('katex') || el.matches?.(GemiBoost.Config.SELECTORS.MATH_INLINE)) {
      const tex = this.extractTex(el);
      return tex ? `$${tex}$` : '';
    }

    // 4. Thinking process (Flash Thinking / Reasoning blocks / Task steps)
    if (
      tagName === 'thinking-process' ||
      el.matches?.(GemiBoost.Config.SELECTORS.THINKING_CONTAINER) ||
      el.classList.contains('thinking-content') ||
      el.classList.contains('thought-container')
    ) {
      if (!context.includeThinking) {
        return '';
      }
      const isChinese = context.isChinese !== undefined
        ? context.isChinese
        : ((typeof document !== 'undefined' && document.documentElement?.lang?.toLowerCase().startsWith('zh')) || false);
      const label = isChinese ? '思考过程' : 'Thought Process';
      const thinkingContent = this.serializeChildren(el, { ...context, isInsideThinking: true }).trim();
      if (!thinkingContent) return '';
      const quoted = thinkingContent
        .split('\n')
        .map((line) => (line.trim() ? `> ${line}` : '>'))
        .join('\n');
      return `\n\n> 💭 **[${label}]**\n${quoted}\n\n`;
    }

    // 5. Code blocks (custom Gemini <code-block> or standard <pre><code>)
    if (tagName === 'code-block' || tagName === 'pre') {
      return this.serializeCodeBlock(el);
    }

    // 6. Tables
    if (tagName === 'table') {
      return this.serializeTable(el);
    }

    // 7. Headings
    if (/^h[1-6]$/.test(tagName)) {
      const level = parseInt(tagName[1], 10);
      const text = this.serializeChildren(el, context).trim();
      return `\n\n${'#'.repeat(level)} ${text}\n\n`;
    }

    // 8. Paragraphs and block divisions
    if (tagName === 'p') {
      const content = this.serializeChildren(el, context).trim();
      return content ? `\n\n${content}\n\n` : '';
    }

    // 9. Blockquotes
    if (tagName === 'blockquote') {
      const quoteText = this.serializeChildren(el, context).trim();
      const prefixed = quoteText
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `\n\n${prefixed}\n\n`;
    }

    // 10. Lists (unordered and ordered)
    if (tagName === 'ul' || tagName === 'ol') {
      const isOrdered = tagName === 'ol';
      const listItems = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
      const depth = context.listDepth || 0;
      const indent = '  '.repeat(depth);

      const itemsMarkdown = listItems.map((li, index) => {
        const marker = isOrdered ? `${index + 1}. ` : '- ';
        const childContext = { ...context, listDepth: depth + 1 };
        const itemContent = this.serializeChildren(li, childContext).trim();
        return `${indent}${marker}${itemContent}`;
      });

      return `\n\n${itemsMarkdown.join('\n')}\n\n`;
    }

    if (tagName === 'li') {
      return this.serializeChildren(el, context);
    }

    // 11. Inline code
    if (tagName === 'code' && !context.isCodeBlock) {
      const codeText = el.textContent || '';
      return `\`${codeText}\``;
    }

    // 12. Inline text styling
    if (tagName === 'strong' || tagName === 'b') {
      const content = this.serializeChildren(el, context);
      return content ? `**${content}**` : '';
    }

    if (tagName === 'em' || tagName === 'i') {
      const content = this.serializeChildren(el, context);
      return content ? `*${content}*` : '';
    }

    if (tagName === 's' || tagName === 'del' || tagName === 'strike') {
      const content = this.serializeChildren(el, context);
      return content ? `~~${content}~~` : '';
    }

    // 13. Links
    if (tagName === 'a') {
      const href = el.getAttribute('href') || '';
      const text = this.serializeChildren(el, context).trim() || href;
      if (!href || href.startsWith('javascript:')) return text;
      return `[${text}](${href})`;
    }

    // 14. Images
    if (tagName === 'img') {
      const src = el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || 'image';
      if (!src) return '';
      return `![${alt}](${src})`;
    }

    // 15. Horizontal rules
    if (tagName === 'hr') {
      return '\n\n---\n\n';
    }

    // 16. Line breaks
    if (tagName === 'br') {
      return '\n';
    }

    // Default container traversal
    return this.serializeChildren(el, context);
  },

  // Helper to serialize all child nodes of an element
  serializeChildren: function (element, context = {}) {
    let result = '';
    const childNodes = Array.from(element.childNodes);

    for (const child of childNodes) {
      result += this.serializeNode(child, context);
    }

    return result;
  },

  // Extract LaTeX source string from KaTeX or MathJax element
  extractTex: function (element) {
    const annotation = element.querySelector(GemiBoost.Config.SELECTORS.MATH_TEX_ANNOTATION);
    if (annotation && annotation.textContent) {
      return annotation.textContent.trim();
    }
    const texAttr = element.getAttribute('data-tex') || element.getAttribute('data-math');
    if (texAttr) return texAttr.trim();

    return element.textContent ? element.textContent.trim() : '';
  },

  // Format code blocks with language annotations
  serializeCodeBlock: function (element) {
    let language = '';

    // Extract language identifier from decoration header or class
    const langSpan = element.querySelector(GemiBoost.Config.SELECTORS.CODE_LANG);
    if (langSpan && langSpan.textContent) {
      language = langSpan.textContent.trim().toLowerCase();
    }

    if (!language) {
      const classMatch = element.className.match(/language-([a-zA-Z0-9_-]+)/);
      if (classMatch) {
        language = classMatch[1].toLowerCase();
      }
    }

    // Locate the element containing actual code text
    const codeEl = element.querySelector('code') || element.querySelector('pre') || element;
    let codeText = codeEl.textContent ? codeEl.textContent.replace(/\r\n/g, '\n') : '';

    // Strip leading decoration if it leaked into textContent
    if (langSpan && langSpan.textContent && codeText.startsWith(langSpan.textContent)) {
      codeText = codeText.substring(langSpan.textContent.length).replace(/^\s+/, '');
    }

    // Determine backtick fence length to safely encapsulate any nested backticks
    let fence = '```';
    while (codeText.includes(fence)) {
      fence += '`';
    }

    return `\n\n${fence}${language}\n${codeText.trimEnd()}\n${fence}\n\n`;
  },

  // Convert HTML table element to GitHub Flavored Markdown (GFM)
  serializeTable: function (tableElement, context = {}) {
    const rows = Array.from(tableElement.querySelectorAll('tr'));
    if (rows.length === 0) return '';

    const matrix = [];
    let maxCols = 0;

    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => {
        const text = this.serializeChildren(cell, context).trim();
        return text.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
      });
      if (cells.length > maxCols) {
        maxCols = cells.length;
      }
      matrix.push(cells);
    });

    if (maxCols === 0) return '';

    // Normalize row lengths
    matrix.forEach((row) => {
      while (row.length < maxCols) {
        row.push('');
      }
    });

    const headerRow = matrix[0];
    const dataRows = matrix.slice(1);

    const headerMd = `| ${headerRow.join(' | ')} |`;
    const separatorMd = `| ${headerRow.map(() => '---').join(' | ')} |`;
    const dataMd = dataRows.map((r) => `| ${r.join(' | ')} |`).join('\n');

    if (dataRows.length > 0) {
      return `\n\n${headerMd}\n${separatorMd}\n${dataMd}\n\n`;
    }
    return `\n\n${headerMd}\n${separatorMd}\n\n`;
  },

  // Clean up extra spacing, tabs, and excess newlines
  postprocessMarkdown: function (markdown) {
    if (!markdown) return '';

    return markdown
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n') // Collapse excessive blank lines
      .trim();
  },

  // Dynamically shift AI headings down to H3+ and isolate code blocks
  demoteAIHeadings: function (markdownText) {
    if (!markdownText) return '';

    const lines = markdownText.split('\n');
    let inCodeBlock = false;
    let codeFenceChar = '';
    let codeFenceLen = 0;

    // Pass 1: Find minimum heading level (L_min) outside code blocks
    let minLevel = 7;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const matchFence = fenceMatch[1];
        const matchChar = matchFence[0];
        const matchLen = matchFence.length;

        if (!inCodeBlock) {
          inCodeBlock = true;
          codeFenceChar = matchChar;
          codeFenceLen = matchLen;
          continue;
        } else if (matchChar === codeFenceChar && matchLen >= codeFenceLen) {
          inCodeBlock = false;
          codeFenceChar = '';
          codeFenceLen = 0;
          continue;
        }
      }

      if (inCodeBlock) continue;

      const headingMatch = line.match(/^((?: {0,3}>[ \t]*)*)(#{1,6})[ \t]+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[2].length;
        if (level < minLevel) {
          minLevel = level;
        }
      }
    }

    // Determine shift amount:
    // If L_min = 1 (used #), shift +2 (# -> ###, ## -> ####, etc.)
    // If L_min = 2 (used ##), shift +1 (## -> ###, ### -> ####, etc.)
    // If L_min >= 3 (used ### or lower, or no headings), shift +0 (keep as-is)
    let shift = 0;
    if (minLevel === 1) {
      shift = 2;
    } else if (minLevel === 2) {
      shift = 1;
    }

    if (shift === 0) {
      return markdownText;
    }

    // Pass 2: Apply shift and bold fallback (> 6) outside code blocks
    inCodeBlock = false;
    codeFenceChar = '';
    codeFenceLen = 0;
    const resultLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const matchFence = fenceMatch[1];
        const matchChar = matchFence[0];
        const matchLen = matchFence.length;

        if (!inCodeBlock) {
          inCodeBlock = true;
          codeFenceChar = matchChar;
          codeFenceLen = matchLen;
          resultLines.push(line);
          continue;
        } else if (matchChar === codeFenceChar && matchLen >= codeFenceLen) {
          inCodeBlock = false;
          codeFenceChar = '';
          codeFenceLen = 0;
          resultLines.push(line);
          continue;
        }
      }

      if (inCodeBlock) {
        resultLines.push(line);
        continue;
      }

      const headingMatch = line.match(/^((?: {0,3}>[ \t]*)*)(#{1,6})[ \t]+(.*)$/);
      if (headingMatch) {
        const quotePrefix = headingMatch[1];
        const origLevel = headingMatch[2].length;
        const titleText = headingMatch[3].trim();
        const newLevel = origLevel + shift;

        if (newLevel <= 6) {
          resultLines.push(`${quotePrefix}${'#'.repeat(newLevel)} ${titleText}`);
        } else {
          // Bold fallback for headings exceeding level 6 to prevent flattening
          resultLines.push(`${quotePrefix}**${titleText}**`);
        }
      } else {
        resultLines.push(line);
      }
    }

    return resultLines.join('\n');
  }
};
