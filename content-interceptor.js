// content-interceptor.js
// Runs in the page MAIN world at document_start to passively capture image URL-to-filename mappings
// from Gemini's batchexecute / StreamGenerate responses and local File object URLs.

(() => {
  if (window.__gemiBoostInterceptorInstalled) return;
  window.__gemiBoostInterceptorInstalled = true;

  const MAX_STORED_ENTRIES = 1000;
  const canonicalEntries = new Map();
  const lookupMap = new Map();
  const normalizedRefCount = new Map();
  const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|tiff?|heic|heif|avif|jfif|dng|raw|psd)$/i;
  const OPAQUE_ID_RE = /^(?:rc|c|r)_[a-zA-Z0-9_-]{4,}$/;

  function isPlaceholderText(trimmedLower) {
    return (
      !trimmedLower ||
      trimmedLower === 'uploaded image preview' ||
      trimmedLower === 'uploaded image' ||
      trimmedLower === 'image preview' ||
      trimmedLower === 'preview image' ||
      trimmedLower === 'preview' ||
      trimmedLower === 'image' ||
      trimmedLower === '[image]' ||
      trimmedLower === '图片' ||
      trimmedLower === '上传的图片预览' ||
      trimmedLower === '上传的图片' ||
      trimmedLower === '图片预览' ||
      trimmedLower.includes('in a lightbox') ||
      trimmedLower.startsWith('show the uploaded image') ||
      trimmedLower.startsWith('open image') ||
      trimmedLower.startsWith('view image') ||
      trimmedLower.startsWith('remove image') ||
      trimmedLower.startsWith('delete image')
    );
  }

  // Strip query strings, hash fragments, and trailing Google FIFE size/option suffixes (e.g. =s1024-rj)
  function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    return url.split('#')[0].split('?')[0].replace(/=[^/]+$/, '');
  }

  function isTargetRpcUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return (
      url.includes('/_/BardChatUi/data/batchexecute') ||
      url.includes('/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate')
    );
  }

  function isValidImageUrl(val) {
    return (
      typeof val === 'string' &&
      val.startsWith('https://lh3.googleusercontent.com/') &&
      !val.startsWith('https://lh3.googleusercontent.com/a/') &&
      !val.startsWith('https://lh3.googleusercontent.com/a-/')
    );
  }

  function isValidFilename(val) {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim();
    if (!trimmed || trimmed.length > 260) return false;
    if (/^https?:\/\//i.test(trimmed)) return false;
    if (trimmed.startsWith('$')) return false;
    if (/[\\\/\r\n\0]/.test(trimmed)) return false;
    if (OPAQUE_ID_RE.test(trimmed)) return false;
    if (isPlaceholderText(trimmed.toLowerCase())) return false;
    return true;
  }

  function isValidRpcImageFilename(val) {
    if (!isValidFilename(val)) return false;
    const trimmed = val.trim();
    return IMAGE_EXT_RE.test(trimmed);
  }

  // Recursively locate [..., fileName, imageUrl, ...] pairs in parsed Gemini RPC payloads
  function extractImageEntries(node, out, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 35) return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const cur = node[i];
        if (cur && typeof cur === 'object') {
          extractImageEntries(cur, out, depth + 1);
        } else if (i > 0 && isValidImageUrl(cur) && isValidRpcImageFilename(node[i - 1])) {
          out.push({ url: cur, fileName: node[i - 1].trim() });
        }
      }
      return;
    }

    const values = Object.values(node);
    for (let i = 0; i < values.length; i++) {
      const val = values[i];
      if (val && typeof val === 'object') {
        extractImageEntries(val, out, depth + 1);
      }
    }
  }

  function collectFromRpcNode(node, out, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12) return;

    if (Array.isArray(node)) {
      if (
        node[0] === 'wrb.fr' &&
        typeof node[2] === 'string' &&
        node[2].includes('lh3.googleusercontent.com')
      ) {
        try {
          const inner = JSON.parse(node[2]);
          extractImageEntries(inner, out, 0);
        } catch (e) {}
      }

      for (let i = 0; i < node.length; i++) {
        const child = node[i];
        if (child && typeof child === 'object') {
          collectFromRpcNode(child, out, depth + 1);
        }
      }
    }
  }

  function incrementNormalizedRef(normalized) {
    if (!normalized) return;
    normalizedRefCount.set(normalized, (normalizedRefCount.get(normalized) || 0) + 1);
  }

  function decrementNormalizedRef(normalized) {
    if (!normalized) return;
    const nextCount = (normalizedRefCount.get(normalized) || 0) - 1;
    if (nextCount <= 0) {
      normalizedRefCount.delete(normalized);
      if (!canonicalEntries.has(normalized)) {
        lookupMap.delete(normalized);
      }
    } else {
      normalizedRefCount.set(normalized, nextCount);
    }
  }

  function recordEntries(entries) {
    if (!entries || entries.length === 0) return;

    const freshEntries = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry || !entry.url || !entry.fileName) continue;

      const normalized = normalizeImageUrl(entry.url);
      if (lookupMap.get(entry.url) === entry.fileName && (!normalized || lookupMap.get(normalized) === entry.fileName)) {
        continue;
      }

      const isNewCanonical = !canonicalEntries.has(entry.url);
      if (isNewCanonical && canonicalEntries.size >= MAX_STORED_ENTRIES) {
        const oldestKey = canonicalEntries.keys().next().value;
        if (oldestKey) {
          canonicalEntries.delete(oldestKey);
          if (!normalizedRefCount.has(oldestKey)) {
            lookupMap.delete(oldestKey);
          }
          decrementNormalizedRef(normalizeImageUrl(oldestKey));
        }
      }

      canonicalEntries.set(entry.url, entry.fileName);
      if (isNewCanonical) {
        incrementNormalizedRef(normalized);
      }
      lookupMap.set(entry.url, entry.fileName);
      if (normalized) {
        lookupMap.set(normalized, entry.fileName);
      }
      freshEntries.push({ url: entry.url, fileName: entry.fileName });
    }

    if (freshEntries.length > 0) {
      try {
        window.postMessage(
          {
            source: 'gemiboost-main',
            type: 'IMAGE_FILENAMES',
            entries: freshEntries
          },
          window.location.origin
        );
      } catch (e) {}
    }
  }

  function processRpcText(text) {
    if (!text || typeof text !== 'string' || !text.includes('lh3.googleusercontent.com')) {
      return;
    }

    const collected = [];
    let parsedAnyLine = false;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || (line[0] !== '[' && line[0] !== '{')) continue;
      if (!line.includes('lh3.googleusercontent.com')) continue;

      try {
        const parsed = JSON.parse(line);
        parsedAnyLine = true;
        collectFromRpcNode(parsed, collected, 0);
        extractImageEntries(parsed, collected, 0);
      } catch (e) {}
    }

    // Fallback for multi-line formatted JSON payloads
    if (!parsedAnyLine) {
      const trimmed = text.trim();
      if (trimmed && (trimmed[0] === '[' || trimmed[0] === '{')) {
        try {
          const parsed = JSON.parse(trimmed);
          collectFromRpcNode(parsed, collected, 0);
          extractImageEntries(parsed, collected, 0);
        } catch (e) {}
      }
    }

    if (collected.length > 0) {
      recordEntries(collected);
    }
  }

  async function readResponseIncremental(clonedRes) {
    if (!clonedRes.body || typeof clonedRes.body.getReader !== 'function' || typeof TextDecoder === 'undefined') {
      const fullText = await clonedRes.text();
      processRpcText(fullText);
      return;
    }

    const reader = clonedRes.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lastNl = buffer.lastIndexOf('\n');
          if (lastNl !== -1) {
            const completePart = buffer.slice(0, lastNl + 1);
            buffer = buffer.slice(lastNl + 1);
            processRpcText(completePart);
          }
        }
      }
    } catch (e) {
      // Flush whatever complete or trailing chunks arrived before stream abort/close
    } finally {
      try {
        buffer += decoder.decode();
      } catch (e) {}
      if (buffer.trim()) {
        processRpcText(buffer);
      }
    }
  }

  let inFlightBatchexecuteCount = 0;

  function isBatchexecuteUrl(url) {
    return typeof url === 'string' && url.includes('/_/BardChatUi/data/batchexecute');
  }

  function emitRpcActivity(phase) {
    try {
      window.postMessage(
        {
          source: 'gemiboost-main',
          type: 'RPC_ACTIVITY',
          inFlightCount: inFlightBatchexecuteCount,
          phase: phase || (inFlightBatchexecuteCount > 0 ? 'start' : 'end'),
          timestamp: Date.now()
        },
        window.location.origin
      );
    } catch (e) {}
  }

  // Intercept fetch() responses for Gemini RPCs
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = function (...args) {
      const reqInfo = args[0];
      const url = typeof reqInfo === 'string' ? reqInfo : (reqInfo && (reqInfo.url || reqInfo.href)) || '';
      const trackRpc = isBatchexecuteUrl(url);
      if (trackRpc) {
        inFlightBatchexecuteCount++;
        emitRpcActivity('start');
      }

      const promise = origFetch.apply(this, args);

      if (isTargetRpcUrl(url)) {
        let finalized = false;
        const finishRpc = () => {
          if (finalized || !trackRpc) return;
          finalized = true;
          inFlightBatchexecuteCount = Math.max(0, inFlightBatchexecuteCount - 1);
          emitRpcActivity('end');
        };

        promise
          .then((res) => {
            if (!res || !res.ok || typeof res.clone !== 'function') {
              finishRpc();
              return;
            }
            readResponseIncremental(res.clone())
              .catch(() => {})
              .finally(finishRpc);
          })
          .catch(finishRpc);
      } else if (trackRpc) {
        promise.then(
          () => {
            inFlightBatchexecuteCount = Math.max(0, inFlightBatchexecuteCount - 1);
            emitRpcActivity('end');
          },
          () => {
            inFlightBatchexecuteCount = Math.max(0, inFlightBatchexecuteCount - 1);
            emitRpcActivity('end');
          }
        );
      }

      return promise;
    };
  }

  // Fallback XHR interception in case Gemini routes any RPC through XMLHttpRequest
  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        this._gbUrl = typeof url === 'string' ? url : String(url || '');
      } catch (e) {
        this._gbUrl = '';
      }
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      if (isBatchexecuteUrl(this._gbUrl) && !this._gbRpcTracked) {
        this._gbRpcTracked = true;
        inFlightBatchexecuteCount++;
        emitRpcActivity('start');
      }

      if (!this._gbLifecycleHooked) {
        this._gbLifecycleHooked = true;
        this.addEventListener('load', function () {
          try {
            if (!isTargetRpcUrl(this._gbUrl)) return;
            if (typeof this.status === 'number' && this.status !== 0 && (this.status < 200 || this.status >= 300)) return;
            if (this.responseType === '' || this.responseType === 'text') {
              processRpcText(this.responseText);
            }
          } catch (e) {}
        });
        this.addEventListener('loadend', function () {
          if (this._gbRpcTracked) {
            this._gbRpcTracked = false;
            inFlightBatchexecuteCount = Math.max(0, inFlightBatchexecuteCount - 1);
            emitRpcActivity('end');
          }
        });
      }
      return origSend.apply(this, args);
    };
  }

  // Capture local File names when Gemini creates blob: preview URLs for newly uploaded images
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      const blobUrl = origCreateObjectURL.call(this, obj);
      try {
        if (
          typeof blobUrl === 'string' &&
          blobUrl.startsWith('blob:') &&
          typeof File !== 'undefined' &&
          obj instanceof File &&
          obj.name &&
          (obj.type ? obj.type.startsWith('image/') : IMAGE_EXT_RE.test(obj.name))
        ) {
          recordEntries([{ url: blobUrl, fileName: obj.name }]);
        }
      } catch (e) {}
      return blobUrl;
    };
  }

  // Replay accumulated entries and RPC activity state when ISOLATED world initializes
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'gemiboost-isolated') return;

    if (data.type === 'REQUEST_RPC_ACTIVITY') {
      emitRpcActivity(inFlightBatchexecuteCount > 0 ? 'start' : 'idle');
      return;
    }

    if (data.type !== 'REQUEST_IMAGE_FILENAMES') return;
    if (canonicalEntries.size === 0) return;

    const entries = [];
    canonicalEntries.forEach((fileName, url) => {
      entries.push({ url, fileName });
    });

    try {
      window.postMessage(
        {
          source: 'gemiboost-main',
          type: 'IMAGE_FILENAMES',
          entries
        },
        window.location.origin
      );
    } catch (e) {}
  });
})();
