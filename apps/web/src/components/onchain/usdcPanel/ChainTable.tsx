"use client";

import type { UsdcNetwork } from "@/lib/onchain/usdcNetwork";
import { BrandLogo, chainName } from "../BrandLogo";
import { ago, Def, dur, Flash, int, StateBadge, usdc } from "./parts";

// One row per chain: live node read + stored-index health side by side, so
// "which chain is healthy, which is lagging, where is the activity" is one
// glance. Solana is labelled for what it is: supply + tracked wallets, not a
// network-wide transfer index.

export function ChainTable({ data, winLabel }: { data: UsdcNetwork; winLabel: string }) {
  const now = Date.now();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-[11.5px] tabular-nums">
        <caption className="sr-only">USDC per chain: state, node head, indexed block, lag, supply and live-window activity</caption>
        <thead>
          <tr className="border-b border-white/[0.07] text-left text-[10.5px] uppercase tracking-wide text-white/45">
            <th scope="col" className="py-1.5 pr-2 font-medium">Chain</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">State</th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="head">Head</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="indexed">Indexed</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="lag">Lag</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="supply">Supply</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="transfers">Transfers</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="volume">Volume</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="minted">Minted</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="burned">Burned</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="senders">Senders</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="receivers">Receivers</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="processing">Processing</Def></th>
            <th scope="col" className="py-1.5 pr-2 text-right font-medium"><Def k="rpc">RPC</Def></th>
            <th scope="col" className="py-1.5 text-right font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {data.chains.map((c) => {
            const h = data.health[c.chain];
            const w = c.window;
            const sol = c.chain === "solana";
            const na = (why: string) => (
              <span className="text-white/30" title={why}>
                n/a
              </span>
            );
            const solNa = na(c.windowReason ?? "Not available for this chain.");
            return (
              <tr key={c.chain} className="border-b border-white/[0.05] align-top">
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <BrandLogo kind="chain" id={c.chain} size={16} />
                    <span className="font-semibold text-white">{chainName(c.chain)}</span>
                  </span>
                  <span className="mt-0.5 block text-[10px] text-white/40">{sol ? "Supply + tracked wallets" : "Network-wide"}</span>
                </th>
                <td className="py-2 pr-2">
                  {h ? <StateBadge state={h.state} reasons={h.reasons} /> : <span className="text-white/35">—</span>}
                  {/* A reason shared by every chain (e.g. no store) is shown once above the table, not per row. */}
                  {h && h.reasons.length > 0 && h.reasons[0] !== data.index.reason && <span className="mt-1 block max-w-[220px] text-[10.5px] leading-snug text-white/50">{h.reasons[0]}</span>}
                </td>
                <td className="py-2 pr-2 text-right">
                  <Flash value={c.latestBlock}>{c.latestBlock === null ? "—" : `#${int(c.latestBlock)}`}</Flash>
                  {c.finalizedBlock !== null && <span className="block text-[10px] text-white/40">fin #{int(c.finalizedBlock)}</span>}
                </td>
                <td className="py-2 pr-2 text-right">
                  {sol ? (
                    h?.wallet?.indexedSlot != null ? (
                      <>
                        #{int(h.wallet.indexedSlot)}
                        <span className="block text-[10px] text-white/40">
                          {int(h.wallet.wallets)} wallets · {int(h.wallet.tokenAccounts)} token accts
                        </span>
                      </>
                    ) : (
                      na("The Solana wallet indexer has not run (add solana to ONCHAIN_NODE_CHAINS and track a wallet).")
                    )
                  ) : h?.indexedBlock != null ? (
                    <>
                      <Flash value={h.indexedBlock}>#{int(h.indexedBlock)}</Flash>
                      {h.supplyReconciled !== null && <span className={`block text-[10px] ${h.supplyReconciled ? "text-white/40" : "text-[#FF8FA3]"}`}>{h.supplyReconciled ? "supply reconciled" : "supply NOT reconciled"}</span>}
                    </>
                  ) : (
                    na(h?.reasons[0] ?? "Not indexed.")
                  )}
                </td>
                <td className="py-2 pr-2 text-right">
                  {sol ? (h?.wallet?.lagSlots != null ? `${int(h.wallet.lagSlots)} slots` : "—") : h?.lagBlocks != null ? (
                    <>
                      {int(h.lagBlocks)} blk
                      <span className="block text-[10px] text-white/40">{dur(h.lagSeconds)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-2 text-right font-semibold text-white" title={c.supply?.latest ?? undefined}>
                  <Flash value={c.supply?.latest}>{usdc(c.supply?.latest)}</Flash>
                </td>
                <td className="py-2 pr-2 text-right">{w ? <Flash value={w.transfers}>{int(w.transfers)}</Flash> : sol ? solNa : "—"}</td>
                <td className="py-2 pr-2 text-right" title={w?.volume}>{w ? usdc(w.volume) : sol ? solNa : "—"}</td>
                <td className="py-2 pr-2 text-right" title={w?.mintVolume}>{w ? usdc(w.mintVolume) : sol ? solNa : "—"}</td>
                <td className="py-2 pr-2 text-right" title={w?.burnVolume}>{w ? usdc(w.burnVolume) : sol ? solNa : "—"}</td>
                <td className="py-2 pr-2 text-right">{w ? int(w.uniqueSenders) : sol ? solNa : "—"}</td>
                <td className="py-2 pr-2 text-right">{w ? int(w.uniqueRecipients) : sol ? solNa : "—"}</td>
                <td className="py-2 pr-2 text-right">{h?.blockProcessingMs != null ? `${int(h.blockProcessingMs)} ms` : "—"}</td>
                <td className="py-2 pr-2 text-right">{c.rpcLatencyMs != null ? `${int(c.rpcLatencyMs)} ms` : "—"}</td>
                <td className="py-2 text-right text-white/60">{ago(c.readAt, now)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[10.5px] text-white/40">Transfers, volume, minted, burned, senders and receivers cover the {winLabel} read live from each node; Head and Supply are the node&apos;s newest block.</p>
    </div>
  );
}
