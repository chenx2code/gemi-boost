// content-catalog.js
// Handles Table of Contents (TOC) logic for Gemini Web

const Catalog = {
  containerId: 'gemiboost-toc-container',
  toggleBtnId: 'gemiboost-toc-toggle',
  isCatalogOpen: false,
  lastQueryCount: 0,
  initAttempts: 0,
  currentUrl: location.href,

  init: function () {
    this.tryInjectUI();
  },

  tryInjectUI: function () {
    // Find the native flex main container
    const mainContainer = document.querySelector('bard-sidenav-container');

    if (mainContainer) {
      this.createUI(mainContainer);
      this.createToggleButton(); // Move here: attempt to create button after main framework is loaded
      this.observeDOM();
      setTimeout(() => this.updateCatalog(), 1000);
    } else {
      // Fallback: if page is still loading, retry every 500ms, up to 20 times (10 seconds)
      this.initAttempts++;
      if (this.initAttempts < 20) {
        setTimeout(() => this.tryInjectUI(), 500);
      } else {
        console.warn("GemiBoost: Could not find <bard-sidenav-container>. TOC injection failed.");
      }
    }
  },

  createUI: function (mainContainer) {
    if (document.getElementById(this.containerId)) return;

    const container = document.createElement('div');
    container.id = this.containerId;

    // Create a fixed-width inner wrapper to prevent text squeezing during width animation
    const innerWrapper = document.createElement('div');
    innerWrapper.id = 'gemiboost-toc-inner';

    const header = document.createElement('div');
    header.className = 'gemiboost-toc-header';
    header.innerHTML = `
      <div class="gemiboost-toc-title">Table of Contents</div>
      <button class="gemiboost-toc-close" aria-label="Close">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>
      </button>
    `;

    const closeBtn = header.querySelector('.gemiboost-toc-close');
    closeBtn.addEventListener('click', () => this.toggleCatalog(false));

    const list = document.createElement('ul');
    list.id = 'gemiboost-toc-list';

    innerWrapper.appendChild(header);
    innerWrapper.appendChild(list);
    container.appendChild(innerWrapper);

    // Critical! Inject container as a flex sibling at the very end of bard-sidenav-container
    mainContainer.appendChild(container);
  },

  createToggleButton: function () {
    // Only display the button on specific chat pages (URL contains /app/ followed by a chat ID)
    // The native new chat page pathname is usually '/app' or '/app/'
    const isChatPage = location.pathname.startsWith('/app/') && location.pathname.length > 5;
    let toggleBtn = document.getElementById(this.toggleBtnId);

    if (!isChatPage) {
        if (toggleBtn) {
            toggleBtn.remove();
        }
        return;
    }

    // 1. Primary: Try to find the native three-dot menu button
    const buttons = document.querySelectorAll('button, [role="button"]');
    let kebabBtn = null;
    for (let btn of buttons) {
      const ariaLabel = btn.getAttribute('aria-label') || '';
      if (ariaLabel.includes("Open menu for conversation actions") ||
        btn.innerHTML.includes('more_vert')) {
        const rect = btn.getBoundingClientRect();
        if (rect.right > window.innerWidth / 2 && rect.top < 100) {
          kebabBtn = btn;
          break;
        }
      }
    }

    // 2. If kebab button is found, insert before it
    if (kebabBtn) {
      const targetIconWrapper = kebabBtn.closest('conversation-actions-icon') || kebabBtn.closest('gem-icon-button');
      if (targetIconWrapper && targetIconWrapper.parentElement) {
        if (!toggleBtn) toggleBtn = this.buildButtonElement();
        if (toggleBtn.parentElement !== targetIconWrapper.parentElement) {
          toggleBtn.classList.add('gemiboost-native-btn');
          targetIconWrapper.parentElement.insertBefore(toggleBtn, targetIconWrapper);
        }
        return;
      }
    }

    // 3. Secondary: If kebab button not found (e.g. new conversation), insert directly into top toolbar container
    const topBarActions = document.querySelector('top-bar-actions .buttons-container') || document.querySelector('top-bar-actions');
    if (topBarActions) {
      if (!toggleBtn) toggleBtn = this.buildButtonElement();
      if (toggleBtn.parentElement !== topBarActions) {
        toggleBtn.classList.add('gemiboost-native-btn');
        // Insert at the far left of the toolbar
        topBarActions.insertBefore(toggleBtn, topBarActions.firstChild);
      }
      return;
    }

    // If neither native container is found, just return and do not create fixed floating button!
    // The MutationObserver will keep monitoring the DOM, and perfectly inject it when the native container is loaded.
  },

  buildButtonElement: function () {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = this.toggleBtnId;
    toggleBtn.title = 'Toggle Table of Contents';
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
      </svg>
    `;
    toggleBtn.addEventListener('click', () => this.toggleCatalog(!this.isCatalogOpen));
    return toggleBtn;
  },

  toggleCatalog: function (show) {
    this.isCatalogOpen = show;
    const container = document.getElementById(this.containerId);
    if (container) {
      if (show) {
        container.classList.add('panel-visible');
        document.body.classList.add('gemiboost-toc-open');
      } else {
        container.classList.remove('panel-visible');
        document.body.classList.remove('gemiboost-toc-open');
      }
    }
  },



  updateCatalog: function () {
    const list = document.getElementById('gemiboost-toc-list');
    if (!list) return;

    const userPrompts = document.querySelectorAll('user-query');

    // Only re-render the entire list when the number of prompts actually changes
    if (userPrompts.length === this.lastQueryCount && userPrompts.length !== 0) {
      return;
    }

    this.lastQueryCount = userPrompts.length;
    const currentScrollTop = list.scrollTop;
    list.innerHTML = '';

    if (userPrompts.length === 0) {
      const li = document.createElement('li');
      li.className = 'gemiboost-toc-empty';
      li.innerText = 'No conversation yet.';
      list.appendChild(li);
      return;
    }

    userPrompts.forEach((promptEl, index) => {
      const li = document.createElement('li');
      li.className = 'gemiboost-toc-item';

      let text = promptEl.innerText.trim();

      // [Core Fix]: Dynamically filter out hidden text intended for screen readers
      const hiddenLabel = promptEl.querySelector('.cdk-visually-hidden, [class*="visually-hidden"]');
      if (hiddenLabel && hiddenLabel.innerText) {
        const hiddenText = hiddenLabel.innerText.trim();
        if (text.startsWith(hiddenText)) {
          text = text.substring(hiddenText.length).trim();
        }
      }

      const fileTexts = new Set();

      // 1. Extract independent images
      const images = Array.from(promptEl.querySelectorAll('img'));
      images.forEach((img, imgIndex) => {
        const parentFile = img.closest('.file-preview-container, [class*="file-preview"]');
        if (parentFile && parentFile.innerText && parentFile.innerText.trim()) {
          return;
        }

        if (fileTexts.has(img.src)) return;
        fileTexts.add(img.src);

        const li = document.createElement('li');
        li.className = 'gemiboost-toc-item gemiboost-toc-attachment';
        li.innerText = '[Image]';
        li.addEventListener('click', () => {
          // Dynamic lookup: prevents detached DOM issues when framework replaces original elements
          const currentQuery = document.querySelectorAll('user-query')[index];
          if (currentQuery) {
            const currentImg = currentQuery.querySelectorAll('img')[imgIndex];
            if (currentImg) currentImg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            else currentQuery.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
        list.appendChild(li);
      });

      // 2. Extract independent files (ignore empty framework shells and prevent nested duplicates)
      const files = Array.from(promptEl.querySelectorAll('.file-preview-container, [class*="file-preview"]'));
      files.forEach((file, fileIndex) => {
        const fileText = file.innerText ? file.innerText.trim() : '';
        if (!fileText) return;

        if (fileTexts.has(fileText)) return;
        fileTexts.add(fileText);

        if (text.includes(fileText)) {
          text = text.replace(fileText, '').trim();
        }

        const li = document.createElement('li');
        li.className = 'gemiboost-toc-item gemiboost-toc-attachment';

        const lines = fileText.split('\n').map(l => l.trim()).filter(l => l);
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

        li.innerText = `[${fileType}] ` + (fName.length > 30 ? fName.substring(0, 30) + '...' : fName);
        li.addEventListener('click', () => {
          const currentQuery = document.querySelectorAll('user-query')[index];
          if (currentQuery) {
            const currentFile = currentQuery.querySelectorAll('.file-preview-container, [class*="file-preview"]')[fileIndex];
            if (currentFile) currentFile.scrollIntoView({ behavior: 'smooth', block: 'center' });
            else currentQuery.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
        list.appendChild(li);
      });

      // 3. Extract remaining pure text
      if (text) {
        const li = document.createElement('li');
        li.className = 'gemiboost-toc-item';
        const textPreview = text.length > 40 ? text.substring(0, 40) + '...' : text;
        li.innerText = textPreview;
        li.title = text;
        li.addEventListener('click', () => {
          const currentQuery = document.querySelectorAll('user-query')[index];
          if (currentQuery) currentQuery.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        list.appendChild(li);
      }

      // 4. Extreme fallback: nothing was extracted
      if (!text && images.length === 0 && files.length === 0) {
        const li = document.createElement('li');
        li.className = 'gemiboost-toc-item';
        li.innerText = '[Empty]';
        li.addEventListener('click', () => {
          const currentQuery = document.querySelectorAll('user-query')[index];
          if (currentQuery) currentQuery.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        list.appendChild(li);
      }
    });

    list.scrollTop = currentScrollTop;
  },

  observeDOM: function () {
    const debouncedUpdate = Utils.debounce(() => {
      this.updateCatalog();
      this.createToggleButton(); // Check if button still exists after DOM changes stabilize, recreate if framework removed it
    }, 1000);
    const observer = new MutationObserver((mutations) => {
      // [Instant Close]: Listen for URL changes and instantly close the sidebar, bypassing the 1000ms delay
      if (this.currentUrl !== location.href) {
        this.currentUrl = location.href;
        if (this.isCatalogOpen) {
          const container = document.getElementById(this.containerId);
          if (container) {
            // Disable transition animation for instant disappearance
            container.style.transition = 'none';
            this.toggleCatalog(false);
            // Force rendering, then restore animation
            void container.offsetHeight;
            container.style.transition = '';
          } else {
            this.toggleCatalog(false);
          }
        }
        // [State Reset]: Instantly destroy the old state when switching to any historical or new chat.
        // The new button will be handled by createToggleButton after 1000ms based on the new page.
        const btn = document.getElementById(this.toggleBtnId);
        if (btn) btn.remove();
      }

      // [Critical! Structural guard cannot be delayed]: Rescue immediately if main container is destroyed, otherwise it causes 1s UI Jank
      if (!document.getElementById(this.containerId)) {
        const mainContainer = document.querySelector('bard-sidenav-container');
        if (mainContainer) {
          this.createUI(mainContainer);
          this.lastQueryCount = 0; // Force re-fetch of catalog content
          this.updateCatalog();    // [Critical Fix]: Generate catalog content synchronously immediately, do not wait for debouncedUpdate!

          if (this.isCatalogOpen) {
            const container = document.getElementById(this.containerId);
            // Temporarily disable transition to prevent slide-out animation since it should already be open
            container.style.transition = 'none';
            container.classList.add('panel-visible');
            // Force browser to apply the above styles
            void container.offsetHeight;
            // Restore animation
            container.style.transition = '';
          }
        }
      }

      let shouldUpdate = false;
      for (let mutation of mutations) {
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          shouldUpdate = true;
          break;
        }
      }
      if (shouldUpdate) {
        debouncedUpdate();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }
};
