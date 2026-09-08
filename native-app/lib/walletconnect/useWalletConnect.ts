import { useCallback, useEffect, useRef, useState } from "react";
import { captureException } from "@/lib/observability";
import { ensureWalletConnect, currentEngine, walletConnectUnavailableReason, type WalletConnectUnavailableReason } from "./runtime";
import type { PendingProposal, PendingRequest, WalletConnectEngine } from "./engine";
import { parsePairingUri, type PairingUriError } from "./uri";
import type { TransportStatus, WalletConnectSession } from "./types";

// ---------------------------------------------------------------------------
// React bindings.
//
// Thin, like lib/signing/useSigner.ts and for the same reason: the behaviour
// lives in the engine as testable logic, and this only bridges subscription to
// render. A hook that owned any of the approval rules would be a rule that
// could only be tested with a renderer.
//
// EVERY SCREEN GETS THE SAME ENGINE. `ensureWalletConnect` is a singleton and
// the hook subscribes to it, so the sessions list, the session detail screen
// and whatever modal is showing a request all see one state. Two components
// each holding their own copy is how a session disappears from one screen and
// not the other.
//
// PENDING PROPOSAL AND REQUEST ARE PULLED, NOT PUSHED. The engine holds one
// slot for each and emits an event when it changes; the hook re-reads the slot
// rather than carrying the payload on the event. That keeps a component that
// mounts LATE — the modal that opens in response to the event — correct: it
// reads the current slot on mount instead of having missed the event that
// carried the data.
// ---------------------------------------------------------------------------

export interface WalletConnectState {
  /** Null while starting, or when WalletConnect cannot run in this build. */
  engine: WalletConnectEngine | null;
  ready: boolean;
  unavailable: WalletConnectUnavailableReason | null;
  status: TransportStatus;
  sessions: WalletConnectSession[];
  pendingProposal: PendingProposal | null;
  pendingRequest: PendingRequest | null;
  /** Non-null when starting the engine itself failed (relay unreachable). */
  startError: string | null;
  refresh: () => void;
}

export function useWalletConnect(): WalletConnectState {
  const [engine, setEngine] = useState<WalletConnectEngine | null>(() => currentEngine());
  const [unavailable, setUnavailable] = useState<WalletConnectUnavailableReason | null>(() =>
    walletConnectUnavailableReason(),
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [status, setStatus] = useState<TransportStatus>(() => currentEngine()?.getStatus() ?? "idle");
  const [sessions, setSessions] = useState<WalletConnectSession[]>([]);
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);

  // Guards a setState after unmount when the async start resolves late.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readAll = useCallback((e: WalletConnectEngine) => {
    setSessions(e.listSessions());
    setPendingProposal(e.getPendingProposal());
    setPendingRequest(e.getPendingRequest());
    setStatus(e.getStatus());
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        const e = await ensureWalletConnect();
        if (!mounted.current) return;
        if (!e) {
          setUnavailable(walletConnectUnavailableReason());
          return;
        }
        setEngine(e);
        setUnavailable(null);
        readAll(e);
        unsubscribe = e.subscribe(() => {
          if (mounted.current) readAll(e);
        });
      } catch (err) {
        captureException(err, { scope: "wc.hook.start" });
        if (mounted.current) setStartError((err as Error).message);
      }
    })();

    return () => unsubscribe?.();
  }, [readAll]);

  const refresh = useCallback(() => {
    const e = currentEngine();
    if (e) readAll(e);
  }, [readAll]);

  return {
    engine,
    ready: engine !== null,
    unavailable,
    status,
    sessions,
    pendingProposal,
    pendingRequest,
    startError,
    refresh,
  };
}

export type PairOutcome =
  | { ok: true }
  | { ok: false; error: PairingUriError }
  | { ok: false; error: { code: "unavailable"; message: string } }
  | { ok: false; error: { code: "pair_failed"; message: string } };

/**
 * Validate a pairing URI and hand it to the relay.
 *
 * PARSING HAPPENS BEFORE THE ENGINE IS TOUCHED. A malformed QR should produce
 * "that is not a connection link" instantly, not after a socket comes up and
 * the SDK rejects it — and it must never reach the SDK at all, since the parser
 * is the layer that decided the input was safe to pass on.
 *
 * Resolving does NOT mean connected. The relay accepting a pairing is only the
 * start; the proposal arrives asynchronously and the user still has to approve
 * it. Callers show "connecting" and wait for `pendingProposal`.
 */
export async function pairWithUri(raw: string, origin: "qr" | "deeplink" | "paste"): Promise<PairOutcome> {
  const parsed = parsePairingUri(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const engine = await ensureWalletConnect();
  if (!engine) {
    return {
      ok: false,
      error: { code: "unavailable", message: "WalletConnect is not available in this build." },
    };
  }

  try {
    // The ORIGINAL string is handed over, not a re-serialised copy. Rebuilding
    // it from the parsed parts risks dropping a relay parameter we did not
    // model, and the SDK needs the URI exactly as the dApp produced it.
    await engine.pair(raw.trim(), origin);
    return { ok: true };
  } catch (e) {
    captureException(e, { scope: "wc.pair" });
    return { ok: false, error: { code: "pair_failed", message: (e as Error).message } };
  }
}
