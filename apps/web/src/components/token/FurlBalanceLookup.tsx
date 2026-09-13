"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Look up the FURL balance of any Solana address.
//
// The mint is NOT part of the request — /api/token/furl/balance pins it server
// side — so this box cannot be talked into reporting a lookalike token's
// balance as FURL.
//
// "Zero" and "could not check" are rendered differently on purpose. A timeout
// shown as 0 FURL would tell someone their holding had vanished.
// ---------------------------------------------------------------------------

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; amount: string; slot: number | null }
  | { kind: "error"; detail: string };

export default function FurlBalanceLookup() {
  const [address, setAddress] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const owner = address.trim();
    if (!owner) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/token/furl/balance?owner=${encodeURIComponent(owner)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as
        | { ok: true; amount: string; slot: number | null }
        | { error: string; detail: string };
      if (!res.ok || !("ok" in json)) {
        setState({
          kind: "error",
          detail: "detail" in json ? json.detail : `Lookup failed (${res.status})`,
        });
        return;
      }
      setState({ kind: "ok", amount: json.amount, slot: json.slot });
    } catch (err) {
      setState({
        kind: "error",
        detail: err instanceof Error ? err.message : "Network request failed",
      });
    }
  }

  return (
    <div className="surface p-6">
      <p className="text-[15px] font-bold">Check a FURL balance</p>
      <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">
        Any Solana address. This reads the chain directly — no account needed, and the result is
        the same one an explorer would give you.
      </p>
      <form onSubmit={check} className="mt-5 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="furl-owner">
          Solana address
        </label>
        <input
          id="furl-owner"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Solana address"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-[12.5px] text-white placeholder:text-textMuted focus:border-neon/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.kind === "loading" || !address.trim()}
          className="btn-green shrink-0 px-5 py-2.5 text-[14px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === "loading" ? "Checking…" : "Check balance"}
        </button>
      </form>

      <div className="mt-4 min-h-[24px]" aria-live="polite">
        {state.kind === "ok" && (
          <p className="font-mono text-[13px] text-neon">
            {Number(state.amount).toLocaleString("en-US", { maximumFractionDigits: 6 })} FURL
            {state.slot != null && (
              <span className="text-textMuted"> · slot {state.slot.toLocaleString("en-US")}</span>
            )}
          </p>
        )}
        {state.kind === "error" && (
          <p className="text-[13px] text-accent">Could not read the balance — {state.detail}</p>
        )}
      </div>
    </div>
  );
}
