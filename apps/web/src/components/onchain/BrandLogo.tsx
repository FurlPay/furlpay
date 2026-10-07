"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// The one place /onchain turns a chain or token name into its official mark.
//
// OFFICIAL MARKS ONLY. The only images are in public/logos/official-onchain/,
// each byte-identical to the project's own publication (see SOURCES.md there,
// verified 2026-10-07). A chain or token without a verified official asset gets
// NO image — not a third-party icon set (the repo's public/logos/chains and
// coins come from TradingView), not a letter badge. Its name is always printed
// next to where the mark would be. In a chart legend the colour key survives
// as a plain swatch, which is a legend key, not a brand mark.
// ---------------------------------------------------------------------------

/** Ledger chain ids → asset file, where the id is not already the file name. */
const CHAIN_FILE: Record<string, { dir: "chains" | "coins"; file: string; name: string }> = {
  arbitrum: { dir: "chains", file: "arbitrum", name: "Arbitrum One" },
  "arbitrum-one": { dir: "chains", file: "arbitrum", name: "Arbitrum One" },
  bsc: { dir: "coins", file: "bnb", name: "BNB Chain" },
  bnb: { dir: "coins", file: "bnb", name: "BNB Chain" },
  tron: { dir: "coins", file: "trx", name: "Tron" },
  near: { dir: "coins", file: "near", name: "NEAR" },
  sui: { dir: "coins", file: "sui", name: "Sui" },
  aptos: { dir: "coins", file: "apt", name: "Aptos" },
  celo: { dir: "coins", file: "celo", name: "Celo" },
  mantle: { dir: "coins", file: "mnt", name: "Mantle" },
  stellar: { dir: "coins", file: "xlm", name: "Stellar" },
  ton: { dir: "coins", file: "ton", name: "TON" },
  xrp_ledger: { dir: "coins", file: "xrp", name: "XRP Ledger" },
  sei: { dir: "coins", file: "sei", name: "Sei" },
};

/** Display names for chains whose id is not already readable (no logo asset implied). */
const CHAIN_NAME: Record<string, string> = {
  zksync: "ZKsync",
  x_layer: "X Layer",
  hyperevm: "HyperEVM",
  robinhood: "Robinhood Chain",
  ink: "Ink",
  plume: "Plume",
  unichain: "Unichain",
};

/** Verified official chain marks (public/logos/official-onchain/SOURCES.md). */
const OFFICIAL_CHAIN: Record<string, string> = {
  ethereum: "ethereum.svg",
  base: "base.svg",
  arbitrum: "arbitrum.png",
  "arbitrum-one": "arbitrum.png",
  polygon: "polygon.svg",
  solana: "solana.svg",
};

function src(kind: "chain" | "token", id: string): { url: string | null; name: string } {
  if (kind === "chain") {
    const key = id.toLowerCase();
    const file = OFFICIAL_CHAIN[key];
    const name = CHAIN_FILE[key]?.name ?? CHAIN_NAME[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
    return { url: file ? `/logos/official-onchain/${file}` : null, name };
  }
  const t = id.toUpperCase();
  return { url: null, name: t }; // no verified official token marks yet
}

/**
 * Official mark for a chain or token, `size` px square. `ring` draws a thin
 * series-colour ring so a chart legend keeps its colour key.
 */
export function BrandLogo({ kind, id, size = 18, ring, className = "" }: { kind: "chain" | "token"; id: string | null | undefined; size?: number; ring?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, ...(ring ? { boxShadow: `0 0 0 1.5px #0A0F10, 0 0 0 3px ${ring}` } : {}) };
  const official = id ? src(kind, id) : null;
  if (!official?.url || failed) {
    // No verified official mark: no image. A legend keeps its colour key as a plain swatch.
    return ring ? <span aria-hidden="true" className={`inline-block shrink-0 rounded-full ${className}`} style={{ width: Math.max(8, size * 0.55), height: Math.max(8, size * 0.55), background: ring }} /> : null;
  }
  const shape = kind === "chain" && id?.toLowerCase() === "base" ? "rounded-[22%]" : "";
  return (
    // Decorative: the chain name is always printed beside the mark.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={official.url} alt="" aria-hidden="true" title={official.name} width={size} height={size} loading="lazy" onError={() => setFailed(true)} className={`inline-block shrink-0 object-contain ${shape} ${className}`} style={style} />
  );
}

/** Display name for a chain id, from the same table as its logo. */
export function chainName(id: string): string {
  return src("chain", id).name;
}
