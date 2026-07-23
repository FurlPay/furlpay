import type { Rail } from "@/lib/ops/controls";
import { publicRailStatuses } from "@/lib/ops/overview";
import { maxSwapUsd, maxCctpUsd, maxTransferUsd } from "@/lib/moneyLimits";

// ---------------------------------------------------------------------------
// Unified payment-rail registry (Tangem blockchain-sdk pattern, TS edition).
//
// One place that describes every rail — protocol, chains, fee model, entry
// endpoints, per-transaction cap — merged with live operational status from
// the ops control plane. The ops dashboard, the public /api/rails discovery
// endpoint, and agent tooling all read the same registry, so a new rail is
// added HERE and appears everywhere.
//
// This intentionally describes rather than wraps: the execution paths
// (x402.ts, cctpExecution.ts, swaps, mpp) stay independent — they move real
// money and each has its own hardening; a leaky common interface would
// weaken, not strengthen, them.
// ---------------------------------------------------------------------------

export interface RailDescriptor {
  rail: Rail;
  name: string;
  protocol: string;
  custody: "non-custodial";
  chains: string[];
  asset: string;
  fee: { model: string; detail: string };
  maxPerTxUsd: number | null;
  endpoints: { method: string; path: string; purpose: string }[];
  docs: string;
}

export function railDescriptors(): RailDescriptor[] {
  return [
    {
      rail: "x402",
      name: "x402 pay-per-call",
      protocol: "HTTP 402 + EIP-3009 transferWithAuthorization",
      custody: "non-custodial",
      chains: ["arbitrum", "base"],
      asset: "USDC",
      fee: { model: "per-call price", detail: "resource sets the price; facilitator pays gas" },
      maxPerTxUsd: null,
      endpoints: [
        { method: "GET", path: "/api/x402/fx", purpose: "example paid resource (402 quote -> pay -> data)" },
        { method: "GET", path: "/api/x402/settlement/{tx}", purpose: "poll a pending settlement" },
        { method: "POST", path: "/api/x402/facilitator/verify", purpose: "verify a payment payload" },
        { method: "POST", path: "/api/x402/facilitator/settle", purpose: "verify + settle on-chain" },
      ],
      docs: "/docs/payments/agentic-x402",
    },
    {
      rail: "mpp",
      name: "Machine Payments Protocol",
      protocol: "Stripe/Tempo MPP over the x402 engine",
      custody: "non-custodial",
      chains: ["arbitrum"],
      asset: "USDC",
      fee: { model: "per-call price", detail: "same settlement engine as x402" },
      maxPerTxUsd: null,
      endpoints: [{ method: "GET", path: "/api/mpp/fx", purpose: "example paid resource (MPP challenge/response)" }],
      docs: "/docs/payments/agentic-x402",
    },
    {
      rail: "cctp",
      name: "CCTP V2 cross-chain USDC",
      protocol: "Circle burn-and-mint (TokenMessengerV2, Iris attestation)",
      custody: "non-custodial",
      chains: ["ethereum", "arbitrum", "base", "polygon"],
      asset: "USDC",
      fee: { model: "network fee", detail: "fast-transfer fee up to 1bp; client signs and pays" },
      maxPerTxUsd: maxCctpUsd(),
      endpoints: [
        { method: "POST", path: "/api/intents/cctp", purpose: "build burn or mint calldata" },
        { method: "GET", path: "/api/intents/cctp/attestation", purpose: "poll the Iris attestation" },
      ],
      docs: "/docs/architecture/api-routes",
    },
    {
      rail: "lifi",
      name: "LI.FI cross-chain swaps",
      protocol: "LI.FI routing (client-signed execution)",
      custody: "non-custodial",
      chains: ["arbitrum", "base", "solana", "ethereum"],
      asset: "any listed token",
      fee: { model: "integrator fee", detail: "0.5% integrator fee on top of route costs" },
      maxPerTxUsd: maxSwapUsd(),
      endpoints: [{ method: "POST", path: "/api/swaps/execute", purpose: "quote + build a swap for client signing" }],
      docs: "/docs/architecture/api-routes",
    },
    {
      rail: "transfers",
      name: "Gasless USDC transfers",
      protocol: "EIP-3009 relay (Smart Gas: fees quoted in USDC, gas sponsored)",
      custody: "non-custodial",
      chains: ["arbitrum"],
      asset: "USDC",
      fee: { model: "sponsored", detail: "relayer pays gas; 0.00 USDC fee at launch" },
      maxPerTxUsd: maxTransferUsd(),
      endpoints: [
        { method: "GET", path: "/api/transfers/gasless", purpose: "Smart Gas fee quote" },
        { method: "POST", path: "/api/transfers/gasless", purpose: "relay a signed authorization" },
        {
          method: "GET",
          path: "/api/transfers/sponsored",
          purpose: "EIP-7702 + Circle Paymaster capability probe (pay gas in USDC from an EOA)",
        },
      ],
      docs: "/docs/payments/agentic-x402",
    },
  ];
}

/** Descriptors merged with live pause/health status — the public rail map. */
export async function railsSnapshot() {
  const statuses = await publicRailStatuses();
  return railDescriptors().map((d) => ({ ...d, status: statuses[d.rail] }));
}
