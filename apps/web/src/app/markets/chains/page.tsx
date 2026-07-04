"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Blocks } from "lucide-react";
import { AssetLogo, ChainLogo } from "@furlpay/ui";
import { CHAINS, chainLogoPath, ChainInfo, Tier } from "@/lib/markets/chains";

// Blockchain networks explorer — 25 major chains as a directory; each card
// links to the native token's market page when listed.

const TIER_LABEL: Record<Tier, string> = { high: "High", medium: "Medium", emerging: "Emerging" };
const TIER_COLOR: Record<Tier, string> = { high: "#30D158", medium: "#FFD60A", emerging: "#8E8E93" };

export default function ChainsPage() {
  const router = useRouter();
  const byCat = (cat: ChainInfo["category"]) => CHAINS.filter((c) => c.category === cat);

  return (
    <>
      <header className="flex items-center gap-3 px-5 pb-2 pt-3">
        <button aria-label="Back" onClick={() => router.back()} className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-[19px] font-extrabold tracking-tighter">Blockchain networks</h1>
          <p className="text-[12px] text-textSecondary">{CHAINS.length} major public chains</p>
        </div>
        <Blocks className="ml-auto h-5 w-5 text-textMuted" />
      </header>

      {(["L1", "L2", "Sidechain", "Appchain"] as const).map((cat) => {
        const list = byCat(cat);
        if (!list.length) return null;
        return (
          <section key={cat} className="mt-5">
            <h2 className="mb-2 px-5 text-[15px] font-bold tracking-tight">
              {cat === "L1" ? "Layer 1" : cat === "L2" ? "Layer 2" : cat} <span className="text-textMuted">· {list.length}</span>
            </h2>
            <div className="grid grid-cols-2 gap-2.5 px-5">
              {list.map((c) => (
                <ChainCard key={c.id} chain={c} />
              ))}
            </div>
          </section>
        );
      })}
      <div className="pb-8" />
    </>
  );
}

function ChainCard({ chain }: { chain: ChainInfo }) {
  const inner = (
    <div className="surface-card h-full p-3.5 transition-colors hover:bg-white/[0.05]">
      <div className="flex items-center gap-2.5">
        {chain.id === "base" ? (
          <ChainLogo chain="base" size={30} />
        ) : (
          <AssetLogo src={chainLogoPath(chain)} label={chain.token} size={30} />
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold leading-tight">{chain.name}</p>
          <p className="text-[11px] text-textMuted">{chain.token} · {chain.launched}</p>
        </div>
      </div>
      <p className="mt-2.5 line-clamp-3 text-[11px] leading-snug text-textSecondary">{chain.blurb}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9.5px] font-semibold text-textSecondary">{chain.consensus}</span>
        <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[9.5px] font-semibold text-textSecondary">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TIER_COLOR[chain.tvlTier] }} />
          TVL {TIER_LABEL[chain.tvlTier]}
        </span>
        <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[9.5px] font-semibold text-textSecondary">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TIER_COLOR[chain.ecosystemTier] }} />
          Ecosystem {TIER_LABEL[chain.ecosystemTier]}
        </span>
      </div>
    </div>
  );
  // Link to the native token's market page when it's in the catalog.
  return chain.token !== "ETH" || chain.id === "ethereum" ? (
    <Link href={`/markets/${chain.token}`}>{inner}</Link>
  ) : (
    <Link href="/markets/ETH">{inner}</Link>
  );
}
