// ---------------------------------------------------------------------------
// FurlPay Device Fingerprinting — Client-Side Signal Collector
//
// Zero-dependency, open-source alternative to Fingerprint.js Pro.
// Collects 25+ high-entropy signals from browser APIs, hashes them into a
// stable visitorId via Web Crypto (SHA-256). No network calls, no paid SDKs.
//
// Signals: canvas, WebGL, AudioContext, fonts, screen, hardware, platform,
//          timezone, languages, and bot/emulator/spoofing detection flags.
//
// Usage:
//   const fp = await collectFingerprint();
//   const vid = await generateVisitorId(fp);
//   fetch('/api/wallets/transfer', { body: JSON.stringify({ deviceSignals: { ...fp, visitorId: vid } }) });
// ---------------------------------------------------------------------------

/** Full device fingerprint with all collected signals. */
export interface DeviceFingerprint {
  // High-entropy hardware probes
  canvasHash: string;
  webglRenderer: string;
  webglVendor: string;
  webglUnmasked: string;
  audioHash: string;

  // Screen & hardware
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  pixelRatio: number;
  touchPoints: number;
  cpuCores: number;
  deviceMemory: number; // GB, 0 if unavailable

  // Platform
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  timezone: string;
  timezoneOffset: number;

  // Browser capabilities
  cookieEnabled: boolean;
  doNotTrack: boolean;
  pdfViewerEnabled: boolean;

  // Font detection (which of the probed fonts are installed)
  installedFonts: string[];

  // Fraud-detection flags
  isWebdriver: boolean;       // navigator.webdriver — Selenium/Puppeteer
  isHeadless: boolean;        // zero dimensions or no languages
  isAutomation: boolean;      // Selenium/Puppeteer global markers
  isEmulatorLikely: boolean;  // tiny screen + hardware mismatch
  isSpoofed: boolean;         // platform vs UA mismatch
  automationMarkers: string[];// which markers were found

  // Timestamp of collection
  collectedAt: string; // ISO
}

// ---- Canvas fingerprint ----

function getCanvasHash(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 280;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";

    // Text with multiple fonts + emoji forces GPU-specific rendering
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60";
    ctx.fillRect(40, 0, 200, 60);
    ctx.fillStyle = "#069";
    ctx.font = "15px 'Arial', sans-serif";
    ctx.fillText("FurlPay 🚀💳 Device", 2, 15);
    ctx.fillStyle = "rgba(102,204,0,0.7)";
    ctx.font = "18px 'Times New Roman', serif";
    ctx.fillText("Fingerprint #2026", 4, 45);

    // Arc + gradient for sub-pixel GPU differences
    ctx.beginPath();
    ctx.arc(120, 30, 20, 0, Math.PI * 2);
    const grad = ctx.createLinearGradient(100, 10, 140, 50);
    grad.addColorStop(0, "#ff0000");
    grad.addColorStop(1, "#0000ff");
    ctx.fillStyle = grad;
    ctx.fill();

    return canvas.toDataURL();
  } catch {
    return "canvas-error";
  }
}

// ---- WebGL fingerprint ----

interface WebGLInfo {
  renderer: string;
  vendor: string;
  unmasked: string;
}

function getWebGLInfo(): WebGLInfo {
  const fallback: WebGLInfo = { renderer: "", vendor: "", unmasked: "" };
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    if (!gl || !(gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext)) return fallback;

    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: gl.getParameter(gl.RENDERER) || "",
      vendor: gl.getParameter(gl.VENDOR) || "",
      unmasked: dbg
        ? `${gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}`
        : "",
    };
  } catch {
    return fallback;
  }
}

// ---- AudioContext fingerprint ----

async function getAudioHash(): Promise<string> {
  try {
    const ac = new OfflineAudioContext(1, 5000, 44100);
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(10000, ac.currentTime);

    const comp = ac.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-50, ac.currentTime);
    comp.knee.setValueAtTime(40, ac.currentTime);
    comp.ratio.setValueAtTime(12, ac.currentTime);
    comp.attack.setValueAtTime(0, ac.currentTime);
    comp.release.setValueAtTime(0.25, ac.currentTime);

    osc.connect(comp);
    comp.connect(ac.destination);
    osc.start(0);

    const buffer = await ac.startRendering();
    const data = buffer.getChannelData(0);

    // Sum a slice — hardware-dependent floating-point differences
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
    return sum.toFixed(6);
  } catch {
    return "audio-error";
  }
}

// ---- Font detection ----

const FONT_PROBES = [
  "Arial", "Verdana", "Times New Roman", "Courier New", "Georgia",
  "Helvetica", "Impact", "Comic Sans MS", "Trebuchet MS", "Palatino",
  "Lucida Console", "Tahoma", "Segoe UI", "Roboto", "San Francisco",
  "Menlo", "Consolas", "Ubuntu", "Noto Sans", "Fira Code",
];

function detectFonts(): string[] {
  try {
    const body = document.body;
    const span = document.createElement("span");
    span.style.fontSize = "72px";
    span.style.position = "absolute";
    span.style.left = "-9999px";
    span.style.top = "-9999px";
    span.style.visibility = "hidden";
    span.textContent = "mmmmmmmmmmlli";
    body.appendChild(span);

    // Baseline widths with generic families
    const baselines: Record<string, number> = {};
    for (const base of ["monospace", "sans-serif", "serif"]) {
      span.style.fontFamily = base;
      baselines[base] = span.offsetWidth;
    }

    const installed: string[] = [];
    for (const font of FONT_PROBES) {
      let detected = false;
      for (const base of ["monospace", "sans-serif", "serif"]) {
        span.style.fontFamily = `'${font}', ${base}`;
        if (span.offsetWidth !== baselines[base]) {
          detected = true;
          break;
        }
      }
      if (detected) installed.push(font);
    }

    body.removeChild(span);
    return installed;
  } catch {
    return [];
  }
}

// ---- Automation / bot markers ----

function detectAutomationMarkers(): string[] {
  const markers: string[] = [];
  const w = window as unknown as Record<string, unknown>;
  const d = document as unknown as Record<string, unknown>;
  const n = navigator as unknown as Record<string, unknown>;

  // Selenium / WebDriver
  if (n.webdriver === true) markers.push("navigator.webdriver");
  if (w.__selenium_unwrapped) markers.push("__selenium_unwrapped");
  if (w.__fxdriver_unwrapped) markers.push("__fxdriver_unwrapped");
  if (d.__selenium_evaluate) markers.push("__selenium_evaluate");
  if (d.__webdriver_evaluate) markers.push("__webdriver_evaluate");
  if (d.__driver_evaluate) markers.push("__driver_evaluate");

  // Puppeteer / Playwright
  if (w.__puppeteer_evaluation_script__) markers.push("puppeteer");
  if (w.__playwright) markers.push("playwright");

  // PhantomJS
  if (w._phantom || w.__phantomas) markers.push("phantomjs");
  if (w.callPhantom) markers.push("callPhantom");

  // Nightmare.js
  if (w.__nightmare) markers.push("nightmare");

  // Generic automation
  if (w.domAutomation || w.domAutomationController) markers.push("domAutomation");

  // CDP (Chrome DevTools Protocol)
  if (n.plugins && (n.plugins as PluginArray).length === 0 && n.userAgent && (n.userAgent as string).includes("HeadlessChrome")) {
    markers.push("HeadlessChrome");
  }

  return markers;
}

// ---- Platform vs UA mismatch detection ----

function detectSpoofing(platform: string, ua: string): boolean {
  const p = platform.toLowerCase();
  const u = ua.toLowerCase();

  // Claims to be Mac but UA says Windows (or vice versa)
  if (p.includes("mac") && u.includes("windows")) return true;
  if (p.includes("win") && (u.includes("macintosh") || u.includes("mac os"))) return true;

  // Claims Linux but UA shows Windows/Mac patterns
  if (p.includes("linux") && !u.includes("android") && (u.includes("windows") || u.includes("macintosh"))) return true;

  // Mobile platform claiming desktop UA
  if ((p.includes("iphone") || p.includes("ipad")) && u.includes("windows")) return true;

  return false;
}

// ---- Headless detection ----

function detectHeadless(): boolean {
  try {
    // Zero outer dimensions = headless
    if (window.outerHeight === 0 && window.outerWidth === 0) return true;

    // No languages array = headless
    if (!navigator.languages || navigator.languages.length === 0) return true;

    // Chrome headless often has no plugins
    if (navigator.plugins && navigator.plugins.length === 0 &&
        /chrome/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ---- Emulator detection ----

function detectEmulator(screen: { width: number; height: number }, cores: number, memory: number): boolean {
  // Extremely small screen = likely emulator
  if (screen.width < 100 || screen.height < 100) return true;

  // High CPU cores but very low memory = VM pattern
  if (cores >= 8 && memory > 0 && memory <= 1) return true;

  // Very low everything = basic emulator
  if (screen.width <= 320 && screen.height <= 240 && cores <= 1) return true;

  return false;
}

// ---- Main collector ----

/** Collect all device fingerprint signals. Async due to AudioContext. */
export async function collectFingerprint(): Promise<DeviceFingerprint> {
  const canvasData = getCanvasHash();
  const webgl = getWebGLInfo();
  const audioHash = await getAudioHash();
  const fonts = detectFonts();
  const automationMarkers = detectAutomationMarkers();

  const sw = window.screen?.width || 0;
  const sh = window.screen?.height || 0;
  const cores = navigator.hardwareConcurrency || 0;
  const memory = (navigator as unknown as Record<string, unknown>).deviceMemory as number || 0;
  const platform = navigator.platform || "";
  const ua = navigator.userAgent || "";

  const isWebdriver = !!(navigator as unknown as Record<string, unknown>).webdriver;
  const isHeadless = detectHeadless();
  const isAutomation = automationMarkers.length > 0;
  const isEmulatorLikely = detectEmulator({ width: sw, height: sh }, cores, memory);
  const isSpoofed = detectSpoofing(platform, ua);

  // Canvas hash (stable)
  let canvasHash: string;
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(canvasData);
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    const arr = Array.from(new Uint8Array(hashBuf));
    canvasHash = arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    canvasHash = "hash-error";
  }

  return {
    canvasHash,
    webglRenderer: webgl.renderer,
    webglVendor: webgl.vendor,
    webglUnmasked: webgl.unmasked,
    audioHash,
    screenWidth: sw,
    screenHeight: sh,
    colorDepth: window.screen?.colorDepth || 0,
    pixelRatio: window.devicePixelRatio || 1,
    touchPoints: navigator.maxTouchPoints || 0,
    cpuCores: cores,
    deviceMemory: memory,
    userAgent: ua,
    platform,
    language: navigator.language || "",
    languages: Array.from(navigator.languages || []),
    timezone: Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone || "",
    timezoneOffset: new Date().getTimezoneOffset(),
    cookieEnabled: navigator.cookieEnabled ?? false,
    doNotTrack: navigator.doNotTrack === "1",
    pdfViewerEnabled: !!(navigator as unknown as Record<string, unknown>).pdfViewerEnabled,
    installedFonts: fonts,
    isWebdriver,
    isHeadless,
    isAutomation,
    isEmulatorLikely,
    isSpoofed,
    automationMarkers,
    collectedAt: new Date().toISOString(),
  };
}

// ---- Visitor ID generation ----

/**
 * Generate a stable SHA-256 visitor ID from the fingerprint.
 * Uses only high-entropy, stable signals (not timestamps or volatile data).
 */
export async function generateVisitorId(fp: DeviceFingerprint): Promise<string> {
  // Combine only stable, high-entropy signals
  const raw = [
    fp.canvasHash,
    fp.webglUnmasked || fp.webglRenderer,
    fp.audioHash,
    fp.screenWidth,
    fp.screenHeight,
    fp.colorDepth,
    fp.pixelRatio,
    fp.cpuCores,
    fp.deviceMemory,
    fp.platform,
    fp.timezone,
    fp.timezoneOffset,
    fp.installedFonts.sort().join(","),
  ].join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const arr = Array.from(new Uint8Array(hashBuf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Convenience: collect fingerprint + generate visitor ID in one call.
 * Returns the full fingerprint with visitorId attached.
 */
export async function getDeviceSignals(): Promise<DeviceFingerprint & { visitorId: string }> {
  const fp = await collectFingerprint();
  const visitorId = await generateVisitorId(fp);
  return { ...fp, visitorId };
}
