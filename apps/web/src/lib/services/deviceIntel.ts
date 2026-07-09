// ---------------------------------------------------------------------------
// FurlPay Device Intelligence — Server-Side Analysis
//
// Takes the client-side DeviceFingerprint + server-side signals (IP, country)
// and produces a risk assessment with bot/emulator/spoofing/travel detection.
// Stores device history in Upstash Redis for returning-device recognition
// and impossible-travel detection.
//
// Plugs into the existing assessRisk()/RiskAssessment interface from
// @furlpay/security so the transfer route can swap it in seamlessly.
// ---------------------------------------------------------------------------

import { kvGet, kvSet } from "@/lib/kv";
import type { DeviceFingerprint } from "@/lib/fingerprint";
import { analyzeBehavior, type BehavioralSignals } from "./behavior";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceIntelResult {
  /** 0-100, higher = riskier */
  score: number;
  level: "low" | "medium" | "high";
  signals: string[];
  action: "allow" | "challenge" | "block";

  /** SHA-256 of stable signals (from client) */
  visitorId: string;
  /** First time this visitorId has been seen */
  isNewDevice: boolean;
  /** Automation / webdriver / headless detected */
  isBot: boolean;
  /** VM or emulator signals */
  isEmulator: boolean;
  /** Platform vs UA mismatch */
  isSpoofed: boolean;
  /** Country changed faster than physically possible */
  impossibleTravel: boolean;
  /** Last known country for this visitorId */
  previousCountry?: string;
  /** Behavioral fingerprint verdict — the AI-browsing-agent detector. Agents
   *  (Comet, Atlas, Claude for Chrome, …) share a human browser fingerprint,
   *  so this is the layer that actually flags them. */
  isLikelyAgent: boolean;
  behaviorScore: number;
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

/** Key storing the last-seen country + timestamp for a visitor. */
const deviceKey = (visitorId: string) => `device:${visitorId}`;

/** How long we remember a device (90 days). */
const DEVICE_TTL_SECONDS = 90 * 24 * 3600;

/** Minimum hours between country changes before flagging impossible travel.
 *  A real person can fly most routes in 3+ hours; anything faster is suspect. */
const MIN_TRAVEL_HOURS = 2;

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a device fingerprint against server-side context and stored history.
 *
 * @param fp - The DeviceFingerprint (and optional visitorId) sent by the client.
 * @param ip - Requesting IP (from x-forwarded-for / x-real-ip).
 * @param country - ISO 3166-1 alpha-2 country code (from x-vercel-ip-country or geo lookup).
 */
export async function analyzeDevice(
  fp: Partial<DeviceFingerprint> & { visitorId?: string; behavior?: BehavioralSignals },
  ip: string | null,
  country: string | null,
): Promise<DeviceIntelResult> {
  let score = 0;
  const flags: string[] = [];
  const visitorId = fp.visitorId || "unknown";

  // ------ Bot / Automation detection ------

  const isBot =
    !!fp.isWebdriver ||
    !!fp.isHeadless ||
    !!fp.isAutomation ||
    (fp.automationMarkers != null && fp.automationMarkers.length > 0);

  if (fp.isWebdriver) {
    score += 75;
    flags.push("navigator.webdriver=true (Selenium/Puppeteer)");
  }
  if (fp.isHeadless && !fp.isWebdriver) {
    score += 60;
    flags.push("headless browser detected (zero dimensions or no languages)");
  }
  if (fp.isAutomation && !fp.isWebdriver) {
    score += 50;
    flags.push(`automation markers: ${(fp.automationMarkers || []).join(", ")}`);
  }

  // ------ Emulator / VM detection ------

  const isEmulator = !!fp.isEmulatorLikely || detectServerSideEmulator(fp);

  if (isEmulator) {
    score += 40;
    flags.push("emulator/VM signals detected");
  }

  // ------ Spoofing detection ------

  const isSpoofed = !!fp.isSpoofed || detectServerSideSpoofing(fp);

  if (isSpoofed) {
    score += 50;
    flags.push("platform/UA mismatch — fingerprint spoofing likely");
  }

  // ------ Device history (Redis) ------

  let isNewDevice = true;
  let impossibleTravel = false;
  let previousCountry: string | undefined;

  if (visitorId !== "unknown") {
    try {
      const stored = await kvGet<{ country: string; ts: number }>(deviceKey(visitorId));

      if (stored) {
        isNewDevice = false;

        // Impossible travel is REPORTED here but not re-scored: velocity.ts
        // owns the authoritative geo-velocity gate on the money path (keyed by
        // userId, not device), so scoring it again would double-count.
        if (country && stored.country && country !== stored.country) {
          const hoursSinceLast = (Date.now() - stored.ts) / 3_600_000;
          if (hoursSinceLast < MIN_TRAVEL_HOURS) {
            impossibleTravel = true;
            flags.push(
              `device country changed ${stored.country} → ${country} in ${hoursSinceLast.toFixed(1)}h`,
            );
          }
          previousCountry = stored.country;
        }
      } else {
        isNewDevice = true;
        score += 10;
        flags.push("new/unrecognized device");
      }

      // Update stored device info
      await kvSet(
        deviceKey(visitorId),
        { country: country || "XX", ts: Date.now() },
        DEVICE_TTL_SECONDS,
      );
    } catch {
      // Redis unavailable — don't crash, just skip device history
      flags.push("device-history-unavailable");
    }
  }

  // ------ Canvas / Audio anomalies ------

  if (fp.canvasHash === "no-canvas" || fp.canvasHash === "canvas-error") {
    score += 15;
    flags.push("canvas API blocked or unavailable");
  }

  if (fp.audioHash === "audio-error") {
    score += 10;
    flags.push("AudioContext blocked — possible privacy browser or bot");
  }

  // ------ Suspiciously perfect values ------

  if (fp.cpuCores === 2 && fp.deviceMemory === 4 &&
      fp.screenWidth === 1920 && fp.screenHeight === 1080 &&
      fp.pixelRatio === 1 && fp.touchPoints === 0) {
    score += 20;
    flags.push("generic desktop profile — possible VM or spoofed environment");
  }

  // ------ Behavioral layer (AI browsing-agent detector) ------
  // Per FP-Agent, this is the high-signal layer: agents share a human browser
  // fingerprint, so only their interaction behavior gives them away.
  const behavior = analyzeBehavior(fp.behavior);
  if (behavior.isLikelyAgent) {
    // Weight to a challenge on its own; combined with any browser signal it
    // reaches the block threshold.
    score += 45;
    flags.push(`AI-agent behavior: ${behavior.signals[0]}`);
  } else if (behavior.agentScore > 0 && !behavior.insufficientData) {
    score += Math.min(20, behavior.agentScore);
    flags.push(`partial agent-like behavior: ${behavior.signals[0]}`);
  }

  // ------ Clamp and classify ------

  score = Math.min(100, score);

  let level: DeviceIntelResult["level"] = "low";
  if (score >= 70) level = "high";
  else if (score >= 30) level = "medium";

  let action: DeviceIntelResult["action"] = "allow";
  if (level === "high") action = "block";
  else if (level === "medium") action = "challenge";

  if (flags.length === 0) flags.push("no adverse device/behavioral signals");

  return {
    score,
    level,
    signals: flags,
    action,
    visitorId,
    isNewDevice,
    isBot,
    isEmulator,
    isSpoofed,
    impossibleTravel,
    previousCountry,
    isLikelyAgent: behavior.isLikelyAgent,
    behaviorScore: behavior.agentScore,
  };
}

// ---------------------------------------------------------------------------
// Server-side heuristics (supplement client-side detection)
// ---------------------------------------------------------------------------

/** Extra emulator checks using signal combinations the client may miss. */
function detectServerSideEmulator(fp: Partial<DeviceFingerprint>): boolean {
  // Screen 0×0 = definitely not a real device
  if (fp.screenWidth === 0 && fp.screenHeight === 0) return true;

  // Mobile-sized screen but desktop-level CPU = emulator running mobile mode
  if (
    fp.screenWidth != null && fp.screenWidth <= 414 &&
    fp.cpuCores != null && fp.cpuCores >= 8 &&
    fp.touchPoints === 0
  ) {
    return true;
  }

  return false;
}

/** Extra spoofing checks using signal cross-correlation. */
function detectServerSideSpoofing(fp: Partial<DeviceFingerprint>): boolean {
  if (!fp.userAgent || !fp.platform) return false;
  const ua = fp.userAgent.toLowerCase();
  const plat = fp.platform.toLowerCase();

  // Claims mobile UA but desktop platform
  if (ua.includes("android") && plat.includes("win")) return true;
  if (ua.includes("iphone") && plat.includes("win")) return true;

  // Claims very old Chrome on modern hardware
  const chromeMatch = ua.match(/chrome\/(\d+)/);
  if (chromeMatch && parseInt(chromeMatch[1]) < 60 && fp.cpuCores != null && fp.cpuCores >= 4) {
    return true; // Ancient Chrome on modern hardware = likely spoofed
  }

  return false;
}
