import { useEffect, useRef, useState } from "react";
import { NetworkError } from "@/lib/api";
import { EVM_ADDRESS_RE, SOLANA_ADDRESS_RE } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import type { Chain } from "@/lib/types";
import { resolveRecipientName, type ResolveOutcome } from "./api";

// ---------------------------------------------------------------------------
// Turning what somebody typed into an address they can actually pay.
//
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE: a failed lookup is not a missing
// name. `GET /contacts/resolve` answers 404 for "no such name" and 503 for "we
// could not check", and it does that deliberately — the server refuses to
// fabricate a negative when its resolver is down. Collapsing the two here would
// throw that away at the last step and tell a user their friend's ENS name does
// not exist because an RPC timed out. So `unavailable` is carried all the way
// to the screen as its own state, with its own words.
//
// THE RESULT IS NEVER APPLIED AUTOMATICALLY. A resolver substituting the
// contents of the "To" field is a silent change of payee, and the whole reason
// this app groups addresses in fours and warns about look-alikes is that silent
// changes of payee are the attack. The hook returns a resolution; the screen
// shows it, with the address in full, and the user accepts it with a tap.
//
// NOTHING IS LOOKED UP THAT IS ALREADY AN ADDRESS. A 0x… string or a base58
// string is the destination, not a name, and asking a resolver about it would
// be a request per keystroke for an answer we already have.
// ---------------------------------------------------------------------------

/** What the screen renders. `idle` means there is nothing to resolve. */
export type NameResolutionState =
  | { kind: "idle" }
  | { kind: "resolving"; name: string }
  | {
      kind: "resolved";
      name: string;
      address: string;
      /** False when the address cannot receive on the chain being paid. */
      payableOnChain: boolean;
      /** Set when the resolved address is already in the address book. */
      contactName?: string;
      display: string;
    }
  /** The resolver answered, and there is no such name. */
  | { kind: "unresolved"; name: string }
  /** The lookup FAILED. We do not know whether the name exists. */
  | { kind: "unavailable"; name: string; message: string }
  /** The input could never be a name (too long, wrong shape). */
  | { kind: "invalid"; name: string; message: string }
  /** The device is offline, which is not the same as the resolver being down. */
  | { kind: "offline"; name: string };

/**
 * Worth asking the server about?
 *
 * Deliberately permissive about WHAT a name looks like — the server supports
 * ENS, FurlPay handles and whatever it adds next, and a client-side pattern
 * that tries to predict the list is a client-side pattern that silently stops
 * resolving the day a new kind is added. It only rules out the two things that
 * are certainly not names: an address, and something too short to be one.
 */
export function looksResolvable(input: string): boolean {
  const value = input.trim();
  if (value.length < 3 || value.length > 255) return false;
  if (EVM_ADDRESS_RE.test(value)) return false;
  if (SOLANA_ADDRESS_RE.test(value)) return false;
  // A bare "0x…" that is the wrong length is a mistyped address, not a name.
  if (/^0[xX]/.test(value)) return false;
  return true;
}

function toState(name: string, outcome: ResolveOutcome): NameResolutionState {
  switch (outcome.status) {
    case "resolved":
      return {
        kind: "resolved",
        name,
        address: outcome.address,
        payableOnChain: outcome.payableOnChain,
        display: outcome.display,
        ...(outcome.contact ? { contactName: outcome.contact.name } : {}),
      };
    case "unresolved":
      return { kind: "unresolved", name };
    case "unavailable":
      return { kind: "unavailable", name, message: outcome.message };
    case "invalid":
      return { kind: "invalid", name, message: outcome.message };
  }
}

/**
 * Resolve `input` as a name, debounced, with the previous request aborted.
 *
 * The abort matters for correctness rather than politeness: without it a slow
 * answer for "ali" can land after the answer for "alice.eth" and repaint the
 * screen with the wrong address — the same class of bug the api client's
 * `signal` support was added for.
 */
export function useNameResolution(input: string, chain: Chain | undefined): NameResolutionState {
  const settled = useDebounced(input.trim(), 400);
  const [state, setState] = useState<NameResolutionState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();

    if (!looksResolvable(settled)) {
      setState({ kind: "idle" });
      return;
    }

    const ac = new AbortController();
    controller.current = ac;
    setState({ kind: "resolving", name: settled });

    resolveRecipientName(settled, chain, ac.signal)
      .then((outcome) => {
        if (ac.signal.aborted) return;
        setState(toState(settled, outcome));
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        // Offline is its own answer. Reporting it as "we could not check" would
        // be true but useless — the fix is different, and the user knows it.
        if (e instanceof NetworkError) {
          setState({ kind: "offline", name: settled });
          return;
        }
        setState({
          kind: "unavailable",
          name: settled,
          message: "We couldn't check that name right now.",
        });
      });

    return () => ac.abort();
  }, [settled, chain]);

  return state;
}
