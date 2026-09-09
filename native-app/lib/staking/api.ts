import { api } from "@/lib/api";
import type { ChainId } from "@/lib/swap/assets";
import type { StakingProtocol } from "./types";
import type { StakingInterface } from "./onchain";

// ---------------------------------------------------------------------------
// The staking client.
//
// The server owns which protocols exist and what their addresses are, because
// an address is the one field that must be verified by a person against the
// protocol's own documentation (apps/web/src/lib/staking/registry.ts). The app
// never carries a staking address in its bundle — a shipped address cannot be
// corrected without an app-store release, and a wrong one is unrecoverable.
// ---------------------------------------------------------------------------

interface ProtocolsResponse {
  configured: boolean;
  protocols: Array<{
    id: string;
    name: string;
    chain: string;
    assetSymbol: string;
    receiptSymbol: string;
    accounting: string;
    exit: string;
    contractInterface: string;
    contract: string | null;
    receiptToken: string | null;
    sourceUrl: string | null;
    verified: boolean;
    unbondingDays: number | null;
    aprPercent: number | null;
    aprAsOf: string | null;
    risks: string[];
  }>;
  notice: string;
}

export interface StakingCatalogue {
  configured: boolean;
  protocols: Array<StakingProtocol & { contractInterface: StakingInterface }>;
  notice: string;
}

const CHAINS = new Set<string>(["ethereum", "arbitrum", "base", "polygon"]);

export async function fetchStakingProtocols(): Promise<StakingCatalogue> {
  const res = await api<ProtocolsResponse>("/staking/protocols");

  const protocols = (res.protocols ?? [])
    .map((p) => {
      // A chain this build cannot sign for is dropped rather than rendered:
      // offering it produces a screen whose only outcome is a failed
      // transaction on a network the app has no RPC for.
      if (!CHAINS.has(p.chain)) return null;

      // An unrecognised interface is dropped for the same reason encodeStake
      // refuses one — there is no correct calldata to build, and guessing is
      // how a deposit reaches the wrong function.
      const contractInterface: StakingInterface | null =
        p.contractInterface === "erc4626"
          ? "erc4626"
          : p.contractInterface === "native_submit"
            ? "native_submit"
            : null;
      if (!contractInterface) return null;

      const accounting = p.accounting === "rebasing" ? "rebasing" : "exchange_rate";
      const exit = p.exit === "secondary_market_only" ? "secondary_market_only" : "withdrawal_queue";

      return {
        id: p.id,
        name: p.name,
        chain: p.chain as ChainId,
        assetSymbol: p.assetSymbol,
        receiptSymbol: p.receiptSymbol,
        accounting,
        exit,
        contractInterface,
        contract: p.contract,
        receiptToken: p.receiptToken,
        sourceUrl: p.sourceUrl,
        // Never upgraded client-side. The server decides verification; a client
        // that could set this flag could stake into an unverified address.
        verified: p.verified === true,
        unbondingDays: typeof p.unbondingDays === "number" ? p.unbondingDays : null,
        // Only a finite, non-negative number is accepted. A null, a string or a
        // NaN renders as "rate unavailable" rather than as a figure.
        aprPercent:
          typeof p.aprPercent === "number" && Number.isFinite(p.aprPercent) && p.aprPercent >= 0
            ? p.aprPercent
            : null,
        aprAsOf: typeof p.aprAsOf === "string" ? p.aprAsOf : null,
        risks: Array.isArray(p.risks) ? p.risks.filter((r): r is string => typeof r === "string") : [],
      } satisfies StakingProtocol & { contractInterface: StakingInterface };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return {
    configured: res.configured === true,
    protocols,
    notice: typeof res.notice === "string" ? res.notice : "",
  };
}
