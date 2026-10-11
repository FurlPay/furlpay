// No imports: safe for client components.

/**
 * Display names for CCTP domains, from Circle's official list
 * (developers.circle.com/cctp/cctp-supported-blockchains, read 2026-10-07).
 * Labels ONLY: verification never uses this table — it reads the chains
 * FurlPay has an RPC for (chainOfDomain / evmRpcFor).
 */
export const CCTP_DOMAIN_NAMES: Record<number, string> = {
  0: "Ethereum", 1: "Avalanche", 2: "OP Mainnet", 3: "Arbitrum", 5: "Solana", 6: "Base", 7: "Polygon PoS", 8: "Sui", 9: "Aptos",
  10: "Unichain", 11: "Linea", 12: "Codex", 13: "Sonic", 14: "World Chain", 15: "Monad", 16: "Sei", 17: "BNB Smart Chain", 18: "XDC",
  19: "HyperEVM", 21: "Ink", 22: "Plume", 25: "Starknet", 26: "Arc", 27: "Stellar", 28: "EDGE", 29: "Injective", 30: "Morph",
  31: "Pharos", 32: "Cronos", 33: "Plasma", 37: "X Layer",
};
export const domainName = (d: number | null | undefined) => (d === null || d === undefined ? null : CCTP_DOMAIN_NAMES[d] ?? null);
