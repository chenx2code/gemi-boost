// content-interceptor.js
// Runs in the page MAIN world at document_start to passively capture image URL-to-filename mappings
// from Gemini's batchexecute / StreamGenerate responses and local File object URLs.

(() => {
  if (window.__gemiBoostInterceptorInstalled) return;
  window.__gemiBoostInterceptorInstalled = true;

  const MAX_STORED_ENTRIES = 1000;
  const canonicalEntries = new Map();
  const lookupMap = new Map();

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
    return true;
  }

  // Recursively locate [..., fileName, imageUrl, ...] pairs in parsed Gemini RPC payloads
  function extractImageEntries(node, out, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 35) return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const cur = node[i];
        if (cur && typeof cur === 'object') {
          extractImageEntries(cur, out, depth + 1);
        } else if (i > 0 && isValidImageUrl(cur) && isValidFilename(node[i - 1])) {
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

      if (canonicalEntries.size >= MAX_STORED_ENTRIES && !canonicalEntries.has(entry.url)) {
        const oldestKey = canonicalEntries.keys().next().value;
        if (oldestKey) {
          canonicalEntries.delete(oldestKey);
          lookupMap.delete(oldestKey);
          const oldestNormalized = normalizeImageUrl(oldestKey);
          if (oldestNormalized) lookupMap.delete(oldestNormalized);
        }
      }

      canonicalEntries.set(entry.url, entry.fileName);
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
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || (line[0] !== '[' && line[0] !== '{')) continue;
      if (!line.includes('lh3.googleusercontent.com')) continue;

      try {
        const parsed = JSON.parse(line);
        collectFromRpcNode(parsed, collected, 0);
        extractImageEntries(parsed, collected, 0);
      } catch (e) {}
    }

    if (collected.length > 0) {
      recordEntries(collected);
    }
  }

  // Intercept fetch() responses for Gemini RPCs
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = function (...args) {
      const reqInfo = args[0];
      const url = typeof reqInfo === 'string' ? reqInfo : (reqInfo && (reqInfo.url || reqInfo.href)) || '';
      const promise = origFetch.apply(this, args);

      if (isTargetRpcUrl(url)) {
        promise
          .then((res) => {
            if (!res || !res.ok || typeof res.clone !== 'function') return;
            res.clone().text().then(processRpcText).catch(() => {});
          })
          .catch(() => {});
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
      if (isTargetRpcUrl(this._gbUrl)) {
        this.addEventListener('load', function () {
          try {
            if (this.responseType === '' || this.responseType === 'text') {
              processRpcText(this.responseText);
            }
          } catch (e) {}
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
          (!obj.type || obj.type.startsWith('image/'))
        ) {
          recordEntries([{ url: blobUrl, fileName: obj.name }]);
        }
      } catch (e) {}
      return blobUrl;
    };
  }

  // Replay accumulated entries when the ISOLATED world extractor finishes initializing
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'gemiboost-isolated' || data.type !== 'REQUEST_IMAGE_FILENAMES') return;
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
