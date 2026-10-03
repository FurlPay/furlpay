import { createPublicClient, getAddress, hexToBigInt, http, parseAbi, type Hex } from "viem";
import { EVM_CHAINS, rpcUrls } from "@/lib/x402Chains";
import type { Finding } from "@/lib/settlementDetectors";

// ---------------------------------------------------------------------------
// Settlement-token integrity monitor (finding FP-SET-07).
//
// The settler pins token ADDRESSES (lib/x402Assets.ts). An address says nothing
// about the code behind it: every token below is an upgradeable proxy, so its
// issuer can swap the implementation, hand the proxy to a new admin, transfer
// ownership (which controls pauser/blacklister/minter roles) or pause it. The
// receipt check in lib/settlementGuard.ts catches a misbehaving token AFTER a
// settlement; this catches the change itself, before the next one.
//
// WHAT IS PINNED, AND HOW IT WAS ESTABLISHED. Read on 2026-10-03 with
// eth_getStorageAt / eth_call against each chain's public RPC. All four use the
// ZeppelinOS AdminUpgradeabilityProxy layout (FiatTokenProxy and XSGD alike):
// implementation and admin in the `org.zeppelinos.proxy.*` slots. Their
// EIP-1967 slots were read too and are EMPTY — a monitor watching EIP-1967
// would have watched nothing. Do not assume a new token uses either layout:
// read it, and add it here only with the layout it actually has.
//
// A legitimate issuer upgrade WILL halt settlement on that network. That is
// the intended behaviour: someone verifies the new implementation against the
// issuer's published announcement, updates the pin in a reviewed commit, and
// recovers through the approval workflow. An automatic re-baseline would turn
// "the token changed" into "the token changed and we accepted it silently".
// ---------------------------------------------------------------------------

export const ZOS_IMPLEMENTATION_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3" as const; // keccak256("org.zeppelinos.proxy.implementation")
export const ZOS_ADMIN_SLOT = "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b" as const; // keccak256("org.zeppelinos.proxy.admin")

export interface PinnedToken {
  network: string;
  symbol: string;
  address: string;
  layout: "zos";
  implementation: string;
  admin: string;
  owner: string;
  verifiedAt: string;
}

/** Observed values, not guesses — see the header for how each was read. */
export const PINNED_TOKENS: readonly PinnedToken[] = [
  {
    network: "arbitrum", symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", layout: "zos",
    implementation: "0x86E721b43d4ECFa71119Dd38c0f938A75Fdb57B3", admin: "0x2E0A67588cfBCAD40f9e4DD76052436190A77a68",
    owner: "0xc7a599037fDa4Ff8029df9a042Af6053d061ebc9", verifiedAt: "2026-10-03",
  },
  {
    network: "base", symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", layout: "zos",
    implementation: "0x2Ce6311ddAE708829bc0784C967b7d77D19FD779", admin: "0x4fc7850364958d97B4d3f5A08f79db2493f8cA44",
    owner: "0x3ABd6f64A422225E61E435baE41db12096106df7", verifiedAt: "2026-10-03",
  },
  {
    network: "polygon", symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", layout: "zos",
    implementation: "0x235AE97b28466Db30469b89A9fe4cFf0659f82Cb", admin: "0x9238E612387eBBA4D4Fa0d76DbFbA99b453417b3",
    owner: "0xAEE29e350Dbb28Ce77D0595D898be658626d2BCC", verifiedAt: "2026-10-03",
  },
  {
    network: "arbitrum", symbol: "XSGD", address: "0xE333e7754a2DC1E020a162Ecab019254b9DaB653", layout: "zos",
    implementation: "0xb9f5fc449dDd21302Ab52aF1FfeA8d7A49614D3b", admin: "0xe71755750dcA4Bd16645B7b2bEDfDdc162e22f31",
    owner: "0x01a5c17D8431543EC228675a9e750F9F7788f3D6", verifiedAt: "2026-10-03",
  },
];

export interface TokenObservation {
  implementation: string | null;
  admin: string | null;
  owner: string | null;
  paused: boolean | null;
}

export type TokenReader = (token: PinnedToken) => Promise<TokenObservation>;

const eq = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();

/**
 * Compare one observation to its pin. Policy:
 *   implementation or proxy admin changed → halt (critical): different code, or
 *                                            a different party able to swap it
 *   owner changed                         → halt (high): roles can be reassigned
 *   paused                                → degrade: settlements would revert;
 *                                            clears when unpaused
 *   any field unreadable                  → degrade: integrity cannot be shown,
 *                                            which is not the same as "unchanged"
 */
export function evaluateToken(token: PinnedToken, o: TokenObservation): Finding[] {
  const base = { network: token.network, token: token.symbol, address: token.address };
  const findings: Finding[] = [];
  if (o.implementation === null || o.admin === null || o.owner === null || o.paused === null) {
    findings.push({
      signal: "token_monitor_unavailable",
      severity: "medium",
      action: "degrade",
      evidence: { ...base, unreadable: Object.entries(o).filter(([, v]) => v === null).map(([k]) => k) },
    });
  }
  if (o.implementation !== null && !eq(o.implementation, token.implementation)) {
    findings.push({ signal: "token_implementation_changed", severity: "critical", action: "halt", evidence: { ...base, pinned: token.implementation, observed: o.implementation } });
  }
  if (o.admin !== null && !eq(o.admin, token.admin)) {
    findings.push({ signal: "token_admin_changed", severity: "critical", action: "halt", evidence: { ...base, pinned: token.admin, observed: o.admin } });
  }
  if (o.owner !== null && !eq(o.owner, token.owner)) {
    findings.push({ signal: "token_owner_changed", severity: "high", action: "halt", evidence: { ...base, pinned: token.owner, observed: o.owner } });
  }
  if (o.paused === true) {
    findings.push({ signal: "token_paused", severity: "high", action: "degrade", evidence: base });
  }
  return findings;
}

const AUTH_ABI = parseAbi(["function owner() view returns (address)", "function paused() view returns (bool)"]);

/** Read one token over the network's first configured RPC. Never throws: an
 *  unreadable field is null, which evaluateToken treats as "cannot verify". */
export const readToken: TokenReader = async (token) => {
  const chain = EVM_CHAINS[token.network];
  const url = rpcUrls(token.network)[0];
  const empty: TokenObservation = { implementation: null, admin: null, owner: null, paused: null };
  if (!chain || !url) return empty;
  const c = createPublicClient({ chain, transport: http(url, { timeout: 6_000, retryCount: 1 }) });
  const address = token.address as Hex;
  const slot = async (s: Hex) => {
    try {
      const v = await c.getStorageAt({ address, slot: s });
      return v && hexToBigInt(v) !== 0n ? getAddress(`0x${v.slice(-40)}`) : null;
    } catch {
      return null;
    }
  };
  const call = async <T>(fn: "owner" | "paused"): Promise<T | null> => {
    try {
      return (await c.readContract({ address, abi: AUTH_ABI, functionName: fn })) as T;
    } catch {
      return null;
    }
  };
  const [implementation, admin, owner, paused] = await Promise.all([
    slot(ZOS_IMPLEMENTATION_SLOT),
    slot(ZOS_ADMIN_SLOT),
    call<string>("owner"),
    call<boolean>("paused"),
  ]);
  return { implementation, admin, owner, paused };
};

/** Findings for every pinned token on `network`. */
export async function checkNetworkTokens(network: string, read: TokenReader = readToken): Promise<Finding[]> {
  const tokens = PINNED_TOKENS.filter((t) => t.network === network);
  const results = await Promise.all(tokens.map(async (t) => evaluateToken(t, await read(t))));
  return results.flat();
}
