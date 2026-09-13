"use client";

import { useEffect, useState } from "react";
import { getJSON } from "@/lib/api";

// ---------------------------------------------------------------------------
// The part of /token that is read off the chain, not typed into the page.
//
// WHY THESE FIELDS. Supply, decimals, MINT AUTHORITY and FREEZE AUTHORITY are
// the four facts that decide whether holding a token is safe, and all four can
// change (or be revoked) after this page is written. A hardcoded "mint
// authority: revoked" would be a lie the day before it became true, and a
// hardcoded "active" would keep claiming risk that no longer exists. So the
// page asks the chain and prints the answer.
//
// FAILURE IS VISIBLE, NEVER PAPERED OVER. When the RPC is unset or failing this
// renders "unavailable" with the reason. It does NOT fall back to the static
// numbers in the section above, because checking those numbers is the entire
// purpose of this panel — a fallback would make the check always pass.
// ---------------------------------------------------------------------------

interface ChainState {
  ok: true;
  programId: string;
  isToken2022: boolean;
  decimals: number;
  supply: string;
  supplyRaw: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: string[];
  matchesExpected: boolean;
  slot: number | null;
}

interface Concentration {
  ok: true;
  holders: { tokenAccount: string; amount: string; sharePercent: string }[];
  topHolderPercent: string;
  nonZeroAccounts: number;
}

type Failed = { ok: false; error: string; detail: string };

interface Payload {
  chain: ChainState | Failed;
  concentration: Concentration | Failed;
}

function Row({
  label,
  children,
  tone = "neutral",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  const toneClass =
    tone === "good" ? "text-neon" : tone === "warn" ? "text-accent" : "text-textPrimary";
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-3 last:border-0">
      <p className="text-[13px] text-textSecondary">{label}</p>
      <p className={`min-w-0 break-all text-right font-mono text-[12.5px] ${toneClass}`}>{children}</p>
    </div>
  );
}

export default function FurlChainState() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getJSON<Payload>("/api/token/furl", { signal: ctrl.signal })
      .then(setData)
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Request failed");
      });
    return () => ctrl.abort();
  }, []);

  if (error) {
    return (
      <div className="surface p-6">
        <p className="text-[15px] font-bold">Live chain state unavailable</p>
        <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">
          We could not reach a Solana RPC to read the mint just now, so nothing is shown rather
          than a cached number. Verify directly on{" "}
          <a className="text-neon hover:underline" href="https://solscan.io" rel="noreferrer">
            an explorer
          </a>{" "}
          instead. <span className="font-mono text-[11.5px] text-textMuted">({error})</span>
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="surface p-6">
        <p className="text-[13px] text-textSecondary">Reading the mint from Solana…</p>
      </div>
    );
  }

  const { chain, concentration } = data;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="surface p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-bold">Mint, as the chain reports it</p>
          {chain.ok && (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                chain.matchesExpected ? "bg-neon/15 text-neon" : "bg-accent/15 text-accent"
              }`}
            >
              {chain.matchesExpected ? "Matches" : "Mismatch"}
            </span>
          )}
        </div>

        {chain.ok ? (
          <div className="mt-4">
            <Row label="Token program">
              {chain.isToken2022 ? "Token-2022" : chain.programId || "unknown"}
            </Row>
            <Row label="Decimals">{chain.decimals}</Row>
            <Row label="Total supply">{Number(chain.supply).toLocaleString("en-US")} FURL</Row>
            <Row label="Mint authority" tone={chain.mintAuthority ? "warn" : "good"}>
              {chain.mintAuthority ? `active · ${chain.mintAuthority}` : "revoked (none)"}
            </Row>
            <Row label="Freeze authority" tone={chain.freezeAuthority ? "warn" : "good"}>
              {chain.freezeAuthority ? `active · ${chain.freezeAuthority}` : "none"}
            </Row>
            <Row label="Extensions">
              {chain.extensions.length ? chain.extensions.join(", ") : "none"}
            </Row>
            {chain.slot != null && <Row label="Read at slot">{chain.slot.toLocaleString("en-US")}</Row>}
            {chain.mintAuthority && (
              <p className="mt-4 rounded-lg border border-accent/25 bg-accent/[0.06] p-3 text-[12.5px] leading-relaxed text-textSecondary">
                The mint authority is still active, which means more FURL can technically be
                minted. Revoking it is irreversible and has not been done yet — so today the 1B
                supply is a published intention enforced by us, not by the runtime.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-[13px] leading-relaxed text-textSecondary">
            Unavailable ({chain.error}). {chain.detail}
          </p>
        )}
      </div>

      <div className="surface p-6">
        <p className="text-[15px] font-bold">Who holds it</p>
        {concentration.ok ? (
          <div className="mt-4">
            <Row label="Largest account holds" tone="warn">
              {concentration.topHolderPercent}%
            </Row>
            <Row label="Non-zero token accounts">
              {concentration.nonZeroAccounts}
              {concentration.nonZeroAccounts >= 20 ? "+ (RPC caps at 20)" : ""}
            </Row>
            {concentration.holders.slice(0, 5).map((h) => (
              <Row key={h.tokenAccount} label={`${h.sharePercent}% · ${h.tokenAccount.slice(0, 8)}…`}>
                {h.amount} FURL
              </Row>
            ))}
            <p className="mt-4 rounded-lg border border-accent/25 bg-accent/[0.06] p-3 text-[12.5px] leading-relaxed text-textSecondary">
              Supply is concentrated in a single token account. That is a real risk to anyone
              holding FURL: one key can move all of it, and there is no multisig in front of it
              yet. It is published here rather than left for someone to discover.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[13px] leading-relaxed text-textSecondary">
            Unavailable ({concentration.error}). {concentration.detail}
          </p>
        )}
      </div>
    </div>
  );
}
