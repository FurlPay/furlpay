"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// The one place /onchain turns a chain or token name into its official mark.
//
// Assets are the repo's existing official marks: public/logos/chains/* and
// public/logos/coins/* (TradingView's crypto logo set, already used across
// the app), plus Base's square from base-org/brand-kit. Nothing is redrawn.
//
// The file is resolved by NAME and the browser reports whether it exists: a
// token or chain without an asset falls back to a neutral monogram badge on
// the image's error event, rather than this file guessing a table of which
// assets exist.
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

/** Wrapped / bridged tickers share the underlying asset's mark. */
const TOKEN_ALIAS: Record<string, string> = { WETH: "eth", WBTC: "btc", CBBTC: "btc", WSOL: "sol", "USDC.E": "usdc", USDT0: "usdt", POL: "pol", MATIC: "pol" };

function src(kind: "chain" | "token", id: string): { url: string; name: string } {
  if (kind === "chain") {
    const key = id.toLowerCase();
    const hit = CHAIN_FILE[key];
    if (hit) return { url: `/logos/${hit.dir}/${hit.file}.svg`, name: hit.name };
    return { url: `/logos/chains/${key.replace(/[^a-z0-9-]/g, "")}.svg`, name: CHAIN_NAME[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ") };
  }
  const t = id.toUpperCase();
  const file = TOKEN_ALIAS[t] ?? t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return { url: `/logos/coins/${file}.svg`, name: t };
}

/**
 * Official mark for a chain or token, `size` px square. `ring` draws a thin
 * series-colour ring so a chart legend keeps its colour key.
 */
export function BrandLogo({ kind, id, size = 18, ring, className = "" }: { kind: "chain" | "token"; id: string | null | undefined; size?: number; ring?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const shape = kind === "chain" && id?.toLowerCase() === "base" ? "rounded-[22%]" : "rounded-full";
  const style = { width: size, height: size, ...(ring ? { boxShadow: `0 0 0 1.5px #0A0F10, 0 0 0 3px ${ring}` } : {}) };
  if (!id || failed) {
    const label = (id ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, kind === "token" ? 3 : 2) || "?";
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-white/[0.08] font-semibold uppercase leading-none text-white/75 ${className}`}
        style={{ ...style, fontSize: Math.max(7, size * 0.36) }}
        role="img"
        aria-label={id ?? "unknown"}
      >
        {label}
      </span>
    );
  }
  const { url, name } = src(kind, id);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} title={name} width={size} height={size} loading="lazy" onError={() => setFailed(true)} className={`inline-block shrink-0 ${shape} ${className}`} style={style} />
  );
}

/** Display name for a chain id, from the same table as its logo. */
export function chainName(id: string): string {
  return src("chain", id).name;
}
