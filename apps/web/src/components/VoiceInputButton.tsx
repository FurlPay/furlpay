"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Dictate-into-a-field button (Web Speech API).
//
// RENDERS NOTHING WHEN UNSUPPORTED. SpeechRecognition is a prefixed, non-
// standard API: Chrome/Edge/Safari ship it, Firefox does not. A mic button that
// is visible but inert is worse than no button — the user taps it, nothing
// happens, and there is no way to tell whether they mis-tapped or the app is
// broken. Support is probed on the CLIENT after mount (the check is meaningless
// during SSR, and rendering the button on the server then removing it would
// hydrate-mismatch), so the control appears only where it works.
//
// RECOGNITION IS NOT DICTATION-SAFE INPUT. The transcript is handed to the
// caller as plain text and nothing more: it is never executed, never used to
// navigate directly, and never submitted on the user's behalf. It fills the
// field, and the human still presses Search. That keeps a misheard phrase a
// typo rather than an action.
// ---------------------------------------------------------------------------

/** Minimal shape of the vendor-prefixed API — the DOM lib does not declare it. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceInputButtonProps {
  /** Called with the final transcript. */
  onResult: (transcript: string) => void;
  /** Accessible name, e.g. "Search destination by voice". */
  label: string;
  /** BCP-47 tag. Defaults to the browser's language. */
  lang?: string;
  className?: string;
}

export default function VoiceInputButton({
  onResult,
  label,
  lang,
  className = "",
}: VoiceInputButtonProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Probe after mount — see the note above on SSR/hydration.
  useEffect(() => setSupported(getRecognitionCtor() !== null), []);

  // Abort any in-flight session on unmount, or the mic indicator stays lit
  // after the user navigates away.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    // A second tap while listening means "stop", not "start again" — starting
    // an already-running recognition throws InvalidStateError.
    if (listening) {
      stop();
      return;
    }

    setError(null);
    const recognition = new Ctor();
    recognition.lang = lang || (typeof navigator !== "undefined" ? navigator.language : "en-US");
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) onResult(transcript);
    };
    recognition.onerror = (event) => {
      // "aborted" is what unmount/stop produces — not worth showing.
      if (event.error === "aborted") return;
      setError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone blocked. Allow mic access in your browser settings."
          : event.error === "no-speech"
            ? "Didn't catch that — try again."
            : "Voice input isn't available right now."
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      // Throws if a session is somehow already running; treat as a no-op.
      setListening(false);
    }
  }, [lang, listening, onResult, stop]);

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        onClick={start}
        aria-label={listening ? "Stop listening" : label}
        aria-pressed={listening}
        title={listening ? "Stop listening" : label}
        className={`shrink-0 rounded-full p-1.5 transition ${
          listening
            ? "bg-neon/20 text-neon"
            : "text-textSecondary hover:bg-white/10 hover:text-white"
        } ${className}`}
      >
        {listening ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Mic className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
      {/* Announced to screen readers; the visual state is the button itself. */}
      <span className="sr-only" role="status" aria-live="polite">
        {listening ? "Listening" : error ?? ""}
      </span>
      {error ? (
        <span className="pointer-events-none absolute -bottom-5 left-0 text-[11px] text-amber-400">
          {error}
        </span>
      ) : null}
    </>
  );
}
