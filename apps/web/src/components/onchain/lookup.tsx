"use client";

import { useEffect, useState } from "react";
import type { ChainHit, LookupResult } from "@/lib/onchain/lookup";
import { Address } from "./Address";
import { BrandLogo, chainName } from "./BrandLogo";

// Live chain lookup shown under the search box for a FULL tx hash / address.
// Every value comes from /api/onchain/lookup, read from FurlPay's own nodes at
// request time; a chain whose node is missing or failed says so.

/** Shape-only check (client side); the server re-validates. */
export const isChainQuery = (q: string) =>
  /^0x[0-9a-fA-F]{64}$/.test(q) || /^0x[0-9a-fA-F]{40}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(q);

type State = { status: "loading" } | { status: "error"; message: string } | { status: "done"; data: LookupResult };

export function ChainLookup({ q }: { q: string }) {
  const [s, setS] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setS({ status: "loading" });
    fetch(`/api/onchain/lookup?q=${encodeURIComponent(q)}`, { cache: "no-store" })
      .then(async (r) => {
        const b = (await r.json().catch(() => null)) as { ok: true; data: LookupResult } | { ok: false; error?: { message?: string } } | null;
        if (!live) return;
        if (b && b.ok) setS({ status: "done", data: b.data });
        else setS({ status: "error", message: (b && !b.ok && b.error?.message) || (r.status === 429 ? "Too many lookups; try again in a minute." : `Lookup failed (${r.status}).`) });
      })
      .catch(() => live && setS({ status: "error", message: "Network error." }));
    return () => {
      live = false;
    };
  }, [q]);

  if (s.status === "loading") return <p className="py-2 text-[12.5px] text-white/50">Reading the chain…</p>;
  if (s.status === "error") return <p className="py-2 text-[12.5px] text-[#F5B83D]">{s.message}</p>;
  const d = s.data;
  const found = d.chains.filter((c) => c.status === "found");
  const other = d.chains.filter((c) => c.status !== "found");
  return (
    <div className="mt-2 space-y-3 text-[12.5px]">
      <p className="text-[11px] text-white/45">
        Live read from FurlPay&apos;s chain nodes at {new Date(d.readAt).toLocaleTimeString("en-US", { timeZone: "UTC" })} UTC.
        {d.kind === "evm_address" && " Balances on each chain are read at one block."}
      </p>
      {d.screening && (
        <p className={d.screening.listed ? "text-[#FF8FA3]" : "text-white/60"}>
          {d.screening.note}
        </p>
      )}
      {found.length === 0 && <p className="text-white/55">Not found on any chain FurlPay reads.</p>}
      {found.map((c) => (
        <Hit key={c.chain} c={c} />
      ))}
      {other.length > 0 && (
        <ul className="text-[11.5px] text-white/45">
          {other.map((c) => (
            <li key={c.chain}>
              {chainName(c.chain)}: {c.status === "not_found" ? "not found" : c.status === "not_configured" ? "no node configured" : `unavailable${c.reason ? ` (${c.reason})` : ""}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Hit({ c }: { c: ChainHit }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <BrandLogo kind="chain" id={c.chain} size={16} />
        <span className="font-semibold">{chainName(c.chain)}</span>
        {c.succeeded !== undefined && <span className={c.succeeded ? "text-[#00E599]" : "text-[#FF8FA3]"}>{c.succeeded ? "Succeeded" : "Failed"}</span>}
        {c.finality && <span className="text-white/55">{c.finality === "finalized" ? "Finalized" : c.finality === "not_finalized" ? "Not yet finalized" : "Finality unknown"}</span>}
        {c.isContract !== undefined && <span className="text-white/55">{c.isContract ? "Contract" : "Account (no code)"}</span>}
        {c.block && <span className="text-white/45">Block {Number(c.block).toLocaleString("en-US")}</span>}
        {c.atBlock && <span className="text-white/45">At block {Number(c.atBlock).toLocaleString("en-US")}</span>}
        {c.blockTime && <span className="text-white/45">{new Date(c.blockTime).toLocaleString("en-US", { timeZone: "UTC" })} UTC</span>}
        {c.explorerUrl && (
          <a href={c.explorerUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[#7DD3FC] hover:underline">
            Explorer
          </a>
        )}
      </div>
      {c.from && (
        <dl className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5">
          <dt className="text-white/45">From</dt>
          <dd className="min-w-0"><Address value={c.from} /></dd>
          {c.to && (
            <>
              <dt className="text-white/45">To</dt>
              <dd className="min-w-0"><Address value={c.to} /></dd>
            </>
          )}
        </dl>
      )}
      {c.balances && (
        <table className="mt-1 w-full">
          <tbody>
            {c.balances.map((b) => (
              <tr key={b.asset + (b.contract ?? "")} className="border-t border-white/[0.05]">
                <td className="py-1 pr-3 font-medium">{b.asset}{b.native === false && <span className="ml-1 text-[10.5px] text-[#F5B83D]">bridged</span>}</td>
                <td className="py-1 pr-3 text-right font-mono tabular-nums">{b.amount}</td>
                <td className="py-1 text-white/50">{b.contract && b.contract !== "native" ? <Address value={b.contract} label="contract" /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.transfers && c.transfers.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="text-left text-[11px] text-white/45">
              <tr><th className="pb-1 pr-2 font-normal">Asset</th><th className="pb-1 pr-2 text-right font-normal">Amount</th><th className="pb-1 pr-2 font-normal">From</th><th className="pb-1 font-normal">To</th></tr>
            </thead>
            <tbody>
              {c.transfers.map((t, i) => (
                <tr key={i} className="border-t border-white/[0.05] align-top">
                  <td className="py-1 pr-2">{t.asset}{t.native === false && <span className="ml-1 text-[10.5px] text-[#F5B83D]">bridged</span>}{t.kind !== "transfer" && <span className="ml-1 text-[10.5px] text-white/50">{t.kind}</span>}</td>
                  <td className="py-1 pr-2 text-right font-mono tabular-nums">{t.amount ?? <span title="Unregistered token: decimals unknown, raw units shown">{t.amountRaw} raw</span>}</td>
                  <td className="py-1 pr-2"><Address value={t.from} /></td>
                  <td className="py-1"><Address value={t.to} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c.cctp && c.cctp.length > 0 && (
        <ul className="mt-2 space-y-1">
          {c.cctp.map((x, i) => (
            <li key={i} className="flex flex-wrap items-start gap-x-2">
              <span className="font-medium">CCTP {x.side === "burn" ? `burn → ${x.otherName ?? `domain ${x.otherDomain}`}` : `mint ← ${x.otherName ?? `domain ${x.otherDomain}`}`}</span>
              <span className="font-mono tabular-nums">{x.amount} USDC{x.fee ? ` (fee ${x.fee})` : ""}</span>
              <span className="text-white/45">recipient</span>
              <Address value={x.recipient} label="recipient" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
