/**
 * Anti-detection configuration for browser automation.
 * Provides launch arguments and injectable scripts that mask
 * Playwright/automation fingerprints so pages see a real browser.
 */

/**
 * Returns Chromium command-line flags that reduce detectable automation signals.
 */
export function getStealthArgs(): string[] {
  return [
    // Core automation-hiding flags
    '--disable-blink-features=AutomationControlled',

    // Sandboxing (needed in containerised environments)
    '--no-sandbox',
    '--disable-setuid-sandbox',

    // Reduce fingerprinting surface via feature flags
    '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
    '--disable-site-isolation-trials',

    // GPU / rendering flags that real browsers have
    '--enable-features=NetworkService,NetworkServiceInProcess',
    '--allow-running-insecure-content',

    // Disable infobars ("Chrome is being controlled by automated software")
    '--disable-infobars',

    // Prevent crash-reporter / background-networking noise
    '--disable-background-networking',
    '--disable-breakpad',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-first-run',
    '--safebrowsing-disable-auto-update',

    // Window size (overridden per context, but keeps a sane default)
    '--window-size=1920,1080',
  ];
}

/**
 * Returns an array of JavaScript snippets to inject via `page.addInitScript()`.
 * Each snippet patches a specific browser API to hide automation indicators.
 */
export function getStealthScripts(): string[] {
  return [
    // 1. Remove navigator.webdriver
    buildWebdriverOverride(),

    // 2. Spoof navigator.plugins & mimeTypes
    buildPluginSpoof(),

    // 3. Fake chrome.runtime to look like a real Chrome install
    buildChromeRuntimeSpoof(),

    // 4. Mask WebGL vendor/renderer
    buildWebGLMask(),

    // 5. Canvas fingerprint randomisation
    buildCanvasNoise(),

    // 6. AudioContext fingerprint randomisation
    buildAudioContextNoise(),

    // 7. Notification.permission spoof
    buildNotificationPermission(),

    // 8. navigator.permissions.query override
    buildPermissionsQuery(),

    // 9. Consistent hardware concurrency & device memory
    buildHardwareOverrides(),
  ];
}

function buildWebdriverOverride(): string {
  return `
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
    });

    // Also delete the property from the prototype
    const proto = Object.getPrototypeOf(navigator);
    if (proto && Object.getOwnPropertyDescriptor(proto, 'webdriver')) {
      Object.defineProperty(proto, 'webdriver', {
        get: () => false,
        configurable: true,
      });
    }
  `;
}

function buildPluginSpoof(): string {
  return `
    // Create a realistic set of plugins mimicking Chrome on desktop
    const pluginData = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];

    const mimeData = [
      { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      { type: 'application/pdf', suffixes: 'pdf', description: '' },
    ];

    function makeMimeType(data) {
      const mt = Object.create(MimeType.prototype);
      Object.defineProperties(mt, {
        type:        { get: () => data.type },
        suffixes:    { get: () => data.suffixes },
        description: { get: () => data.description },
        enabledPlugin: { get: () => null },
      });
      return mt;
    }

    function makePlugin(data) {
      const p = Object.create(Plugin.prototype);
      Object.defineProperties(p, {
        name:        { get: () => data.name },
        filename:    { get: () => data.filename },
        description: { get: () => data.description },
        length:      { get: () => 0 },
      });
      return p;
    }

    const plugins = pluginData.map(makePlugin);
    const mimeTypes = mimeData.map(makeMimeType);

    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = Object.create(PluginArray.prototype);
        plugins.forEach((p, i) => { arr[i] = p; });
        Object.defineProperty(arr, 'length', { get: () => plugins.length });
        arr.item = (i) => plugins[i] ?? null;
        arr.namedItem = (name) => plugins.find(p => p.name === name) ?? null;
        arr.refresh = () => {};
        return arr;
      },
    });

    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const arr = Object.create(MimeTypeArray.prototype);
        mimeTypes.forEach((m, i) => { arr[i] = m; });
        Object.defineProperty(arr, 'length', { get: () => mimeTypes.length });
        arr.item = (i) => mimeTypes[i] ?? null;
        arr.namedItem = (type) => mimeTypes.find(m => m.type === type) ?? null;
        return arr;
      },
    });
  `;
}

function buildChromeRuntimeSpoof(): string {
  return `
    // Make window.chrome look like a real Chrome installation
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function() { return { onMessage: { addListener: function() {} }, postMessage: function() {}, onDisconnect: { addListener: function() {} } }; },
        sendMessage: function(_msg, _opts, cb) { if (cb) cb(); },
        id: undefined,
        onMessage: { addListener: function() {}, removeListener: function() {} },
        onConnect: { addListener: function() {}, removeListener: function() {} },
        getManifest: function() { return {}; },
        getURL: function(path) { return 'chrome-extension://placeholder/' + path; },
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      };
    }

    // Chrome loadTimes API
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          commitLoadTime: Date.now() / 1000 - 0.5,
          connectionInfo: 'h2',
          finishDocumentLoadTime: Date.now() / 1000 - 0.1,
          finishLoadTime: Date.now() / 1000 - 0.05,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000 - 0.3,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'h2',
          requestTime: Date.now() / 1000 - 1,
          startLoadTime: Date.now() / 1000 - 0.8,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
        };
      };
    }

    // Chrome csi API
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          onloadT: Date.now(),
          pageT: 300 + Math.random() * 200,
          startE: Date.now() - 1000,
          tran: 15,
        };
      };
    }
  `;
}

function buildWebGLMask(): string {
  return `
    // Override WebGL debug info to return spoofed vendor/renderer.
    // The actual values are set per-context via __WEBGL_VENDOR__ / __WEBGL_RENDERER__
    // globals injected before this script.
    const getParameterProto = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      const UNMASKED_VENDOR  = 0x9245;  // WEBGL_debug_renderer_info UNMASKED_VENDOR_WEBGL
      const UNMASKED_RENDERER = 0x9246; // WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL

      if (param === UNMASKED_VENDOR && window.__WEBGL_VENDOR__) {
        return window.__WEBGL_VENDOR__;
      }
      if (param === UNMASKED_RENDERER && window.__WEBGL_RENDERER__) {
        return window.__WEBGL_RENDERER__;
      }
      return getParameterProto.call(this, param);
    };

    // Same for WebGL2
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2Proto = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        const UNMASKED_VENDOR  = 0x9245;
        const UNMASKED_RENDERER = 0x9246;

        if (param === UNMASKED_VENDOR && window.__WEBGL_VENDOR__) {
          return window.__WEBGL_VENDOR__;
        }
        if (param === UNMASKED_RENDERER && window.__WEBGL_RENDERER__) {
          return window.__WEBGL_RENDERER__;
        }
        return getParameter2Proto.call(this, param);
      };
    }
  `;
}

function buildCanvasNoise(): string {
  return `
    // Inject tiny noise into canvas toDataURL / toBlob to vary fingerprint
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          const data = imageData.data;
          // Flip a few random pixel channels by +/- 1
          for (let i = 0; i < Math.min(10, data.length); i++) {
            const idx = Math.floor(Math.random() * data.length);
            data[idx] = Math.max(0, Math.min(255, data[idx] + (Math.random() > 0.5 ? 1 : -1)));
          }
          ctx.putImageData(imageData, 0, 0);
        } catch (_e) {
          // Security exception on cross-origin canvas; ignore
        }
      }
      return origToDataURL.call(this, type, quality);
    };

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(cb, type, quality) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          const data = imageData.data;
          for (let i = 0; i < Math.min(10, data.length); i++) {
            const idx = Math.floor(Math.random() * data.length);
            data[idx] = Math.max(0, Math.min(255, data[idx] + (Math.random() > 0.5 ? 1 : -1)));
          }
          ctx.putImageData(imageData, 0, 0);
        } catch (_e) {
          // Ignore cross-origin canvas errors
        }
      }
      return origToBlob.call(this, cb, type, quality);
    };
  `;
}

function buildAudioContextNoise(): string {
  return `
    // Inject tiny noise into AudioContext frequency data for fingerprint variance
    if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
      const AC = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;

      const origGetFloatFrequency = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function(array) {
        origGetFloatFrequency.call(this, array);
        for (let i = 0; i < array.length; i++) {
          array[i] = array[i] + (Math.random() * 0.0001 - 0.00005);
        }
      };

      const origGetFloatTimeDomain = AnalyserNode.prototype.getFloatTimeDomainData;
      AnalyserNode.prototype.getFloatTimeDomainData = function(array) {
        origGetFloatTimeDomain.call(this, array);
        for (let i = 0; i < array.length; i++) {
          array[i] = array[i] + (Math.random() * 0.0001 - 0.00005);
        }
      };
    }
  `;
}

function buildNotificationPermission(): string {
  return `
    // Override Notification.permission to 'default' (user hasn't decided)
    if (typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true,
      });
    }
  `;
}

function buildPermissionsQuery(): string {
  return `
    // Override navigator.permissions.query to return realistic results
    if (navigator.permissions && navigator.permissions.query) {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(desc) {
        if (desc && desc.name === 'notifications') {
          return Promise.resolve({ state: 'prompt', onchange: null });
        }
        if (desc && desc.name === 'push') {
          return Promise.resolve({ state: 'prompt', onchange: null });
        }
        if (desc && desc.name === 'midi') {
          return Promise.resolve({ state: 'prompt', onchange: null });
        }
        return origQuery(desc);
      };
    }
  `;
}

function buildHardwareOverrides(): string {
  return `
    // Consistent hardware concurrency and device memory.
    // Per-context values are injected via __HARDWARE_CONCURRENCY__ / __DEVICE_MEMORY__ globals.
    if (typeof window.__HARDWARE_CONCURRENCY__ !== 'undefined') {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => window.__HARDWARE_CONCURRENCY__,
        configurable: true,
      });
    }
    if (typeof window.__DEVICE_MEMORY__ !== 'undefined') {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => window.__DEVICE_MEMORY__,
        configurable: true,
      });
    }
  `;
}
