// content-extractor.js
// DOM parser and extractor for user prompts, images, and file attachments

window.GemiBoost = window.GemiBoost || {};

GemiBoost.Extractor = {
  // Extract structured prompt data items from the current live DOM
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
  }
};
