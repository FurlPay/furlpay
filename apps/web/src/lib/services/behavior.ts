// ---------------------------------------------------------------------------
// Behavioral fingerprinting — the signal that actually separates AI browsing
// agents (ChatGPT Atlas, Claude for Chrome, Perplexity Comet, Browser Use,
// Skyvern, Manus) from humans.
//
// Grounded in FP-Agent (Wang, Shafiq, Vekaria — arXiv:2605.01247, May 2026):
// across 7 agents + humans, BROWSER fingerprints classify at F1 ~0.80 (weak —
// agents share the same Chromium fingerprint), while BEHAVIORAL fingerprints
// hit F1 ~0.99. In their Cloudflare case study FP-Agent flagged all 7 agents;
// Cloudflare's bot management blocked 1. deviceIntel.ts is the ~0.80 browser
// layer; this is the ~0.99 behavioral layer, and combining them is what the
// paper shows works best.
//
// The client collects compact aggregate stats over the interaction window
// (never raw event streams — payload + privacy) and posts them in
// deviceSignals.behavior. Discriminators, per the paper's measurements:
//   - Mouse: agents emit NO continuous movement — a single mousemove then
//     mousedown/mouseup at the click target ("teleport"). Humans stream
//     mousemove between clicks.  §5.3.3
//   - Typing: agents paste, fire change events, or type at 1-12ms inter-key
//     latency with near-zero variance; humans ~120ms mean, ~79ms SD.  §5.3.1
//   - Scroll: agents jump in 0ms-duration bursts to known DOM targets; humans
//     scroll longer and more variably.  §5.3.2
//
// Heuristic, not the paper's XGBoost model — a threshold scorer tuned to the
// most separable features so it runs inline with no model to host. Fail-open.
// ---------------------------------------------------------------------------

export interface BehavioralSignals {
  /** Interaction window the stats cover, ms. */
  sessionMs?: number;
  // Mouse
  mouseMoveCount?: number;
  clickCount?: number;
  /** Distinct mousemove path samples between the last two clicks, if tracked. */
  moveBetweenClicks?: number;
  // Typing
  keyDownCount?: number;
  charsEntered?: number; // total chars that landed in inputs (incl. paste/programmatic)
  pasteCount?: number;
  interKeyMeanMs?: number;
  interKeyStdMs?: number;
  holdMeanMs?: number;
  backspaceCount?: number;
  // Scroll
  scrollBurstCount?: number;
  /** Fraction of scroll bursts with ~0ms duration (instant jumps). 0..1 */
  scrollZeroDurationRatio?: number;
}

export interface BehaviorVerdict {
  /** 0-100, higher = more agent-like. */
  agentScore: number;
  isLikelyAgent: boolean;
  signals: string[];
  /** True when there was too little interaction to judge (don't penalize). */
  insufficientData: boolean;
}

// Thresholds from FP-Agent's per-class latency stats (Table 8) with margin:
// fastest human inter-key mean is ~120ms; every agent that types is <12ms.
const HUMAN_MIN_INTERKEY_MS = 25;
const HUMAN_MIN_INTERKEY_STD_MS = 15;
const MIN_KEYS_FOR_TYPING_JUDGEMENT = 5;
const MIN_CHARS_FOR_PASTE_JUDGEMENT = 8;

export function analyzeBehavior(b: BehavioralSignals | undefined | null): BehaviorVerdict {
  const signals: string[] = [];
  if (!b || typeof b !== "object") {
    return { agentScore: 0, isLikelyAgent: false, signals: ["no behavioral data"], insufficientData: true };
  }

  const clicks = b.clickCount ?? 0;
  const moves = b.mouseMoveCount ?? 0;
  const keys = b.keyDownCount ?? 0;
  const chars = b.charsEntered ?? 0;

  // Not enough interaction to judge — a quick, mostly-keyboard flow can look
  // sparse without being a bot. Don't add risk on thin data.
  const insufficientData = clicks + keys + chars < 3;

  let score = 0;

  // 1. Mouse teleport — clicks with no cursor path. Strongest single signal:
  //    FP-Agent observed zero continuous mousemove for every agent.
  if (clicks >= 2 && moves === 0) {
    score += 50;
    signals.push("clicks with no cursor movement (teleport-to-target)");
  } else if (clicks >= 3 && moves > 0 && moves < clicks) {
    score += 25;
    signals.push("far fewer mouse moves than clicks (discontinuous pointer)");
  }

  // 2. Paste / programmatic form fill — text arrived without keystrokes.
  if (chars >= MIN_CHARS_FOR_PASTE_JUDGEMENT && keys === 0) {
    score += 45;
    signals.push("text entered without keystrokes (paste or programmatic fill)");
  } else if ((b.pasteCount ?? 0) > 0 && keys === 0 && chars > 0) {
    score += 40;
    signals.push("paste-only input, no typing");
  }

  // 3. Machine-speed typing — keystrokes present but inhumanly fast/regular.
  if (
    keys >= MIN_KEYS_FOR_TYPING_JUDGEMENT &&
    b.interKeyMeanMs != null &&
    b.interKeyMeanMs < HUMAN_MIN_INTERKEY_MS &&
    (b.interKeyStdMs == null || b.interKeyStdMs < HUMAN_MIN_INTERKEY_STD_MS)
  ) {
    score += 40;
    signals.push(`typing at ${b.interKeyMeanMs.toFixed(0)}ms/key with near-zero variance`);
  }

  // 4. Instant scroll jumps to DOM targets (weaker; supports the above).
  if ((b.scrollBurstCount ?? 0) >= 3 && (b.scrollZeroDurationRatio ?? 0) > 0.8) {
    score += 15;
    signals.push("scrolling in instant zero-duration jumps");
  }

  score = Math.min(100, score);
  if (signals.length === 0) signals.push("behavior consistent with a human");

  // On thin data, cap the influence so a sparse-but-real session can't be
  // blocked on behavior alone.
  if (insufficientData) score = Math.min(score, 20);

  return {
    agentScore: score,
    isLikelyAgent: score >= 45,
    signals,
    insufficientData,
  };
}
