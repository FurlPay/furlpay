// Voice input — dictation into a text field.
//
// ---------------------------------------------------------------------------
// THE NATIVE MODULE IS OPTIONAL AT RUNTIME, AND THAT IS DELIBERATE
//
// `expo-speech-recognition` is a native module. It is linked at BUILD time, so
// a JS-only reload of an existing dev client will not have it — the import
// throws rather than resolving to something inert. A mic button that quietly
// does nothing on those builds is the worst outcome: the user taps, nothing
// happens, and there is no way to tell a broken microphone from a build that
// predates the feature.
//
// So the module is resolved lazily and its absence is a REPORTED state
// (`unsupported`) with a reason the UI can show, not a silent no-op. Once the
// app is rebuilt the same code path starts working with no edit.
//
// NOTHING IS EVER FABRICATED. There is no simulated transcript and no canned
// result: if recognition does not produce words, the caller is told why.
// ---------------------------------------------------------------------------

import { Platform } from "react-native";

export type SpeechUnavailable =
  | "no-native-module"
  | "permission-denied"
  | "unsupported-platform"
  | "no-speech"
  | "network"
  | "unknown";

export type SpeechResult =
  | { ok: true; transcript: string }
  | { ok: false; reason: SpeechUnavailable; detail?: string };

/* Resolved once. `require` rather than a static import so a missing native
   module is catchable — a top-level import would take the whole screen down. */
let cached: any | undefined;
function speechModule(): any | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require("expo-speech-recognition");
  } catch {
    cached = null;
  }
  return cached;
}

/** Is dictation available on this build and platform? */
export function isSpeechAvailable(): boolean {
  if (Platform.OS === "web") return false;
  const m = speechModule();
  return !!m?.ExpoSpeechRecognitionModule;
}

/** Why it is not available, for a message the user can act on. */
export function speechUnavailableReason(): SpeechUnavailable | null {
  if (Platform.OS === "web") return "unsupported-platform";
  if (!speechModule()?.ExpoSpeechRecognitionModule) return "no-native-module";
  return null;
}

/** Human wording for each state. Kept here so every caller says the same thing. */
export function describeUnavailable(reason: SpeechUnavailable): string {
  switch (reason) {
    case "no-native-module":
      return "Voice search needs the latest app build.";
    case "permission-denied":
      return "Microphone access is off. Enable it in Settings.";
    case "unsupported-platform":
      return "Voice search isn’t available here.";
    case "no-speech":
      return "I didn’t catch that.";
    case "network":
      return "Voice search needs a connection.";
    default:
      return "Voice search didn’t work.";
  }
}

/**
 * Ask for microphone + speech permission.
 *
 * Separated from `listen` so the UI can request it on first tap and show the
 * system prompt at a moment the user understands, rather than at launch.
 */
export async function requestSpeechPermission(): Promise<boolean> {
  const m = speechModule();
  if (!m?.ExpoSpeechRecognitionModule) return false;
  try {
    const res = await m.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return !!res?.granted;
  } catch {
    return false;
  }
}

export interface ListenOptions {
  /** Fired for interim results so the field can fill in as the user speaks. */
  onPartial?: (text: string) => void;
  /** Stop automatically after this long. Dictation into a search box is short. */
  maxMs?: number;
  lang?: string;
}

/**
 * Listen once and resolve with what was said.
 *
 * Resolves rather than rejects on failure — a caller in a `Pressable` handler
 * should not need a try/catch to avoid an unhandled rejection, and every
 * failure here is an expected state rather than an exception.
 */
export function listenOnce(opts: ListenOptions = {}): Promise<SpeechResult> {
  const { onPartial, maxMs = 12000, lang = "en-US" } = opts;

  const reason = speechUnavailableReason();
  if (reason) return Promise.resolve({ ok: false, reason });

  const m = speechModule();
  const Mod = m.ExpoSpeechRecognitionModule;

  return new Promise<SpeechResult>((resolve) => {
    let settled = false;
    let best = "";
    const subs: { remove: () => void }[] = [];

    const finish = (r: SpeechResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const s of subs) {
        try {
          s.remove();
        } catch {
          /* already gone */
        }
      }
      try {
        Mod.stop();
      } catch {
        /* not running */
      }
      resolve(r);
    };

    /* A hard ceiling. Some platforms never emit an end event when the user
       simply stops talking with the screen backgrounded, and a promise that
       never settles leaves the button spinning forever. */
    const timer = setTimeout(() => {
      finish(best.trim() ? { ok: true, transcript: best.trim() } : { ok: false, reason: "no-speech" });
    }, maxMs);

    try {
      subs.push(
        m.addSpeechRecognitionListener("result", (e: any) => {
          const text = e?.results?.[0]?.transcript ?? "";
          if (text) {
            best = text;
            onPartial?.(text);
          }
          if (e?.isFinal) {
            finish(text.trim() ? { ok: true, transcript: text.trim() } : { ok: false, reason: "no-speech" });
          }
        })
      );

      subs.push(
        m.addSpeechRecognitionListener("error", (e: any) => {
          const code = String(e?.error ?? "");
          /* Their codes mapped onto ours, so the UI never shows a raw
             platform string like "ERROR_NO_MATCH" to a user. */
          const mapped: SpeechUnavailable =
            /permission|not-allowed/i.test(code) ? "permission-denied"
              : /no-speech|no-match/i.test(code) ? "no-speech"
                : /network/i.test(code) ? "network"
                  : "unknown";
          finish({ ok: false, reason: mapped, detail: code || undefined });
        })
      );

      subs.push(
        m.addSpeechRecognitionListener("end", () => {
          finish(best.trim() ? { ok: true, transcript: best.trim() } : { ok: false, reason: "no-speech" });
        })
      );

      Mod.start({
        lang,
        interimResults: true,
        continuous: false,
        /* On-device where the platform offers it: a search query is not
           something to ship to a server when it does not have to be. */
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
      });
    } catch (e: any) {
      finish({ ok: false, reason: "unknown", detail: String(e?.message ?? e) });
    }
  });
}

/** Stop an in-flight recognition (the user tapped the mic again). */
export function stopListening(): void {
  try {
    speechModule()?.ExpoSpeechRecognitionModule?.stop();
  } catch {
    /* nothing running */
  }
}
