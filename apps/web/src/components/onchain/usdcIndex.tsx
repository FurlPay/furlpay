"use client";

import type { UsdcIndexView } from "@/lib/onchain/usdcIndex/view";
import { Address } from "./Address";
import { BrandLogo } from "./BrandLogo";
import { Card, Unavailable } from "./ui";
import { usePolled, useTick } from "./usdcPanel/hooks";
import { ago, int, usdc } from "./usdcPanel/parts";

// ---------------------------------------------------------------------------
// Ethereum USDC index (migration 0036, lib/onchain/usdcIndex). Every value is
// read from /api/onchain/token/usdc/metrics — the indexer's state row — and
// covers FINALIZED blocks only. Approximate figures (HyperLogLog unique
// counts) are marked "≈" with their standard error; a window that reaches
// before the indexed history says so instead of showing a partial number.
// ---------------------------------------------------------------------------

const WINDOWS: [string, string][] = [
  ["1h", "1H"],
  ["24h", "24H"],
  ["7d", "7D"],
  ["30d", "30D"],
  ["90d", "90D"],
  ["all", "ALL"],
];

interface Uniq {
  count: number | null;
  exact: boolean;
  stdError?: number;
}
interface Win {
  from: string | null;
  to: string;
  basis: string;
  events: number;
  transfers: number;
  transferRaw: string;
  mints: number;
  mintRaw: string;
  burns: number;
  burnRaw: string;
  txCount: number | null;
  uniqueSenders: Uniq;
  uniqueReceivers: Uniq;
  eventsPerSecond?: number;
  top?: [string, number, number, string, string, string, number][];
  coverage: { complete: boolean; historyFrom: string | null };
}

/** Exact decimal string from integer base units (6 decimals). */
export function rawToUsdc(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null;
  const s = raw.padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}

const STATE_CLS: Record<string, string> = {
  LIVE: "border-[#00E599]/35 bg-[#00E599]/[0.06] text-[#00E599]",
  CATCHING_UP: "border-[#38BDF8]/35 text-[#7DD3FC]",
  BACKFILLING: "border-[#F5B83D]/35 text-[#F5B83D]",
  DEGRADED: "border-[#F5B83D]/35 text-[#F5B83D]",
  PAUSED: "border-white/15 text-white/60",
  ERROR: "border-[#FF4D6D]/35 text-[#FF8FA3]",
};

function UniqCell({ u }: { u: Uniq | undefined }) {
  if (!u || u.count === null) return <span className="text-white/40">—</span>;
  return u.exact ? <>{int(u.count)}</> : <span title={`HyperLogLog estimate, standard error ${((u.stdError ?? 0) * 100).toFixed(2)}%`}>≈{int(u.count)}</span>;
}

export function UsdcIndexPanel() {
  const { data, error, lastOk } = usePolled<UsdcIndexView>("/api/onchain/token/usdc/metrics", 30_000);
  useTick(5_000);
  return <UsdcIndexPanelView data={data} error={error} lastOk={lastOk} />;
}

/** Pure view of /api/onchain/token/usdc/metrics (rendered server-side in tests). */
export function UsdcIndexPanelView({ data, error, lastOk }: { data: UsdcIndexView | null; error: string | null; lastOk: number | null }) {
  const w = (data?.windows ?? {}) as Record<string, Win>;
  const largest = w["1h"]?.top ?? w["24h"]?.top ?? [];
  return (
    <Card
      id="usdc-index"
      title="Ethereum USDC · finalized index"
      source="FurlPay's own index of native USDC Transfer events on Ethereum mainnet, read from archive RPC nodes (finalized blocks only). Counts and volumes are exact; unique senders/receivers over 24H and longer are HyperLogLog estimates."
      action={<span className="text-[11px] text-white/45">{data?.windowsAt ? `Computed ${ago(data.windowsAt)}` : lastOk ? `Read ${ago(lastOk)}` : ""}</span>}
    >
      {error && !data && <Unavailable reason={`USDC index could not be read: ${error}`} />}
      {!data ? (
        !error && <div className="h-[140px] animate-pulse rounded-lg border border-white/[0.06] bg-white/[0.02]" aria-busy="true" aria-label="Loading USDC index" />
      ) : !data.available ? (
        <Unavailable reason={data.reason ?? "Unavailable."} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-white/65">
            <span className="inline-flex items-center gap-1.5">
              <BrandLogo kind="chain" id="ethereum" size={14} />
              <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${STATE_CLS[data.state ?? ""] ?? "border-white/15 text-white/60"}`}>{data.state}</span>
            </span>
            <span>Head #{int(data.head.block)}</span>
            <span>Finalized #{int(data.finalized.block)}</span>
            <span>
              Indexed #{int(data.indexed.block)}
              {data.indexed.time ? ` (${ago(data.indexed.time)})` : ""}
            </span>
            <span>Lag {data.lagBlocks === null ? "—" : `${int(data.lagBlocks)} blocks`}</span>
            <span title={data.supply.atBlock ? `totalSupply() at finalized block ${data.supply.atBlock}` : undefined}>Supply {usdc(rawToUsdc(data.supply.raw))} USDC</span>
            {w["5m"]?.eventsPerSecond !== undefined && <span title="Finalized Transfer events in the last 300 s of block time ÷ 300">{w["5m"].eventsPerSecond.toFixed(2)} events/s</span>}
          </div>
          {!data.history.complete && (
            <p className="mb-2 text-[11px] text-[#F5B83D]">
              History is still backfilling (contiguous through block #{int(data.history.backfillThrough)}; live from #{int(data.history.liveFrom)}). Windows that start before {data.history.liveFromTime ? new Date(data.history.liveFromTime).toUTCString() : "the live anchor"} are marked incomplete.
            </p>
          )}
          {data.lastError && <p className="mb-2 text-[11px] text-[#F5B83D]">Last pass: {data.lastError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[11.5px] tabular-nums">
              <thead className="text-left text-[10.5px] text-white/45">
                <tr>
                  <th className="pb-1 pr-2 font-normal">Window</th>
                  <th className="pb-1 pr-2 text-right font-normal">Transfers</th>
                  <th className="pb-1 pr-2 text-right font-normal">Transfer volume</th>
                  <th className="pb-1 pr-2 text-right font-normal">Minted</th>
                  <th className="pb-1 pr-2 text-right font-normal">Burned</th>
                  <th className="pb-1 pr-2 text-right font-normal">Transactions</th>
                  <th className="pb-1 pr-2 text-right font-normal">Senders</th>
                  <th className="pb-1 text-right font-normal">Receivers</th>
                </tr>
              </thead>
              <tbody>
                {WINDOWS.map(([k, label]) => {
                  const x = w[k];
                  if (!x)
                    return (
                      <tr key={k} className="border-t border-white/[0.05]">
                        <td className="py-1 pr-2 font-medium">{label}</td>
                        <td colSpan={7} className="py-1 text-white/40">Not computed yet</td>
                      </tr>
                    );
                  const partial = !x.coverage?.complete;
                  return (
                    <tr key={k} className="border-t border-white/[0.05]" title={x.basis}>
                      <td className="py-1 pr-2 font-medium">
                        {label}
                        {partial && <span className="ml-1 text-[10px] text-[#F5B83D]" title="This window starts before the indexed history">incomplete</span>}
                      </td>
                      <td className="py-1 pr-2 text-right">{int(x.transfers)}</td>
                      <td className="py-1 pr-2 text-right" title={rawToUsdc(x.transferRaw) ?? undefined}>{usdc(rawToUsdc(x.transferRaw))}</td>
                      <td className="py-1 pr-2 text-right" title={`${int(x.mints)} mint events`}>{usdc(rawToUsdc(x.mintRaw))}</td>
                      <td className="py-1 pr-2 text-right" title={`${int(x.burns)} burn events`}>{usdc(rawToUsdc(x.burnRaw))}</td>
                      <td className="py-1 pr-2 text-right">{x.txCount === null ? <span className="text-white/40" title="Not aggregated for this window">—</span> : int(x.txCount)}</td>
                      <td className="py-1 pr-2 text-right"><UniqCell u={x.uniqueSenders} /></td>
                      <td className="py-1 text-right"><UniqCell u={x.uniqueReceivers} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h3 className="mb-1 mt-3 text-[12px] font-semibold text-white/80">Largest transfers · {w["1h"]?.top ? "last hour" : "last 24 h"} (finalized)</h3>
          {largest.length === 0 ? (
            <p className="text-[11px] text-white/45">No finalized transfers in this window yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[11.5px]">
                <tbody>
                  {largest.slice(0, 5).map(([amount, block, logIndex, tx, from, to]) => (
                    <tr key={`${block}:${logIndex}`} className="border-t border-white/[0.05] align-top">
                      <td className="py-1 pr-3 text-right font-mono tabular-nums">{usdc(rawToUsdc(amount))} USDC</td>
                      <td className="py-1 pr-3"><Address value={from} href={`https://etherscan.io/address/${from}`} /></td>
                      <td className="py-1 pr-3"><Address value={to} href={`https://etherscan.io/address/${to}`} /></td>
                      <td className="py-1"><Address value={tx} label="transaction" href={`https://etherscan.io/tx/${tx}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
