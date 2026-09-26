// ---------------------------------------------------------------------------
// FurlPay Sensory Engine — Haptics, Audio Chimes & Whiggle-Wobble Physics
//
// Modern fintech checkout (PhonePe, Phantom, Cash App, Apple Pay) relies on
// multi-sensory confirmation: tactile haptic clicks, synthesized audio chimes,
// and spring-damped micro-interactions.
//
// ZERO EXTERNAL ASSETS:
// Audio chimes are synthesized directly in code via the Web Audio API
// (AudioContext oscillator nodes + exponential decay envelopes).
// Works offline, requires zero bandwidth, and zero static MP3 files.
// ---------------------------------------------------------------------------

export type HapticType =
  | "light"
  | "medium"
  | "heavy"
  | "selection"
  | "scanLock"
  | "success"
  | "error"
  | "wobbleShake";

/**
 * Triggers tactile haptic vibration patterns across supported mobile devices.
 */
export function triggerHaptic(type: HapticType): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) {
    return;
  }

  try {
    switch (type) {
      case "selection":
        navigator.vibrate(10);
        break;
      case "light":
        navigator.vibrate(15);
        break;
      case "medium":
        navigator.vibrate(30);
        break;
      case "heavy":
        navigator.vibrate(55);
        break;
      case "scanLock":
        // Crisp double-tap when QR or NFC is recognized
        navigator.vibrate([20, 30, 25]);
        break;
      case "success":
        // Celebratory rolling pulse matching PhonePe / Apple Pay confirmation
        navigator.vibrate([35, 45, 30, 50, 60]);
        break;
      case "error":
      case "wobbleShake":
        // Harsh dissonant triple buzz matching PIN failure / error shake
        navigator.vibrate([60, 40, 60, 40, 80]);
        break;
    }
  } catch {
    // Gracefully ignore if device vibration permission is restricted
  }
}

/**
 * Synthesizes the signature FurlPay / PhonePe-style payment success chime.
 * Major Triad: C5 (523.25 Hz) -> E5 (659.25 Hz) -> G5 (783.99 Hz) -> C6 (1046.50 Hz).
 */
export function playPaymentSuccessChime(): void {
  if (typeof window === "undefined") return;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [
      { freq: 523.25, time: 0.0, dur: 0.16 },  // C5
      { freq: 659.25, time: 0.08, dur: 0.18 }, // E5
      { freq: 783.99, time: 0.16, dur: 0.22 }, // G5
      { freq: 1046.50, time: 0.24, dur: 0.55 }, // C6 (long ring)
    ];

    notes.forEach(({ freq, time, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + time);

      // Smooth attack & exponential decay for pure bell timbre
      gain.gain.setValueAtTime(0.001, now + time);
      gain.gain.exponentialRampToValueAtTime(0.28, now + time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + time);
      osc.stop(now + time + dur);
    });

    // Clean up audio context
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Audio context may be blocked by autoplay policies until user gesture
  }
}

/**
 * Subtle tactile audio tick when a QR code or NFC tag is recognized.
 */
export function playScanLockTick(): void {
  if (typeof window === "undefined") return;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);

    setTimeout(() => ctx.close().catch(() => {}), 100);
  } catch {
    // Silently ignore
  }
}

/**
 * Dissonant low buzz for invalid scan, insufficient funds, or biometric rejection.
 */
export function playErrorBuzzer(): void {
  if (typeof window === "undefined") return;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.setValueAtTime(110, now + 0.1);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);

    setTimeout(() => ctx.close().catch(() => {}), 350);
  } catch {
    // Silently ignore
  }
}
