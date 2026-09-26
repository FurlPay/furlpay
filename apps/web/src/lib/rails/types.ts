import { IntegrationNotConfiguredError } from "@/lib/integrations";

// ---------------------------------------------------------------------------
// Generic rail capability interfaces.
//
// WHY THIS FILE EXISTS
// Before it, a "Singapore rail" meant a module named after a company, whose
// docstrings described a commercial relationship that does not exist and whose
// functions returned fabricated success. Naming a seam after a vendor makes
// that easy: the file claims the integration by existing, and there is nowhere
// to put the honest answer "no provider is configured".
//
// So rails are declared here as CAPABILITIES — what the money needs to do —
// and any vendor adapter is a implementation of one, registered at runtime
// only when its credentials are actually present. The rest of the app depends
// on the capability, never on the vendor.
//
//   DomesticFastRail        push fiat to a domestic account, fast
//   PayNowQrCodec           decode/encode a merchant QR (see ./singapore/sgqr)
//   CrossChainSettlementRail move a stablecoin between chains
//   YieldVaultAdapter       park idle balance in a yield-bearing instrument
//
// THE CORE RULE: an unregistered capability throws. There is no fallback that
// invents a quote, a rate, or a settlement. A caller that cannot reach a real
// provider must surface an outage — a fabricated success is the one outcome
// that silently moves (or fails to move) someone's money while reporting fine.
// ---------------------------------------------------------------------------

/** ISO 4217 alpha code. */
export type FiatCurrency = string;

/** Opaque provider identifier, e.g. "straitsx", "bridge". */
export type ProviderId = string;

export interface RailProviderMeta {
  id: ProviderId;
  /** Human name for operator dashboards and audit lines. */
  displayName: string;
  /**
   * Whether a real, credentialled implementation is wired up. A provider that
   * reports false must never be selected for a money path.
   */
  configured: boolean;
  /**
   * What is missing when `configured` is false — env var names, a contract, a
   * license. Shown to operators so an outage is diagnosable rather than
   * mysterious. Never surfaced to end users.
   */
  missing?: string[];
}

// ---------------------------------------------------------------------------
// Capability: domestic fast fiat payout
// ---------------------------------------------------------------------------

export interface DomesticPayoutRequest {
  /** Destination proxy — a UEN, mobile number, IBAN, or account reference. */
  destination: string;
  destinationKind: "uen" | "mobile" | "account" | "iban";
  recipientName: string;
  /** Integer minor units. Never a float: 12.34 is 1234, not 12.34. */
  amountMinor: number;
  currency: FiatCurrency;
  /**
   * Caller-supplied idempotency key. REQUIRED, and deliberately not defaulted
   * to a fresh UUID: a retry must reuse the caller's key or the recipient is
   * paid twice. A provider adapter that ignores this is a bug.
   */
  idempotencyKey: string;
  reference?: string;
}

export interface DomesticPayoutResult {
  providerPayoutId: string;
  /** The clearing scheme the provider actually used, as reported by it. */
  scheme: string;
  status: "accepted" | "processing" | "settled" | "failed";
  /** Provider's own timestamp, not ours — reconciliation compares to theirs. */
  providerTimestamp: string;
}

export interface DomesticFastRail {
  readonly meta: RailProviderMeta;
  /** ISO 3166-1 alpha-2 codes this rail can reach. */
  readonly countries: readonly string[];
  payout(req: DomesticPayoutRequest): Promise<DomesticPayoutResult>;
}

// ---------------------------------------------------------------------------
// Capability: cross-chain stablecoin settlement
// ---------------------------------------------------------------------------

export interface CrossChainQuote {
  providerId: ProviderId;
  /** Integer minor units in, and expected out after all provider fees. */
  amountInMinor: number;
  amountOutMinor: number;
  feeMinor: number;
  estimatedSeconds: number;
  /**
   * True only when the provider guarantees the output amount. A quote that is
   * an estimate must say so, or the router will treat a guess as a commitment.
   */
  guaranteed: boolean;
  expiresAt: string;
}

export interface CrossChainSettlementRail {
  readonly meta: RailProviderMeta;
  supports(fromChain: string, toChain: string, token: string): boolean;
  quote(params: {
    fromChain: string;
    toChain: string;
    token: string;
    amountMinor: number;
  }): Promise<CrossChainQuote>;
}

// ---------------------------------------------------------------------------
// Capability: yield vault
// ---------------------------------------------------------------------------

export interface YieldVaultPosition {
  /** Integer minor units currently deployed in the vault. */
  principalMinor: number;
  /**
   * Yield rate as basis points, AS REPORTED BY THE VAULT at `observedAt`.
   * Never a constant compiled into the app: a hardcoded "4.8% APY" is a
   * forward-looking promise about someone else's instrument, and it is stale
   * the moment it is typed.
   */
  apyBps: number;
  observedAt: string;
}

export interface YieldVaultAdapter {
  readonly meta: RailProviderMeta;
  readonly instrument: string;
  position(accountRef: string): Promise<YieldVaultPosition>;
  /** Liquidate exactly `amountMinor` back into spendable balance. */
  redeem(params: {
    accountRef: string;
    amountMinor: number;
    idempotencyKey: string;
  }): Promise<{ redeemedMinor: number; providerRef: string }>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type Capability = "domesticFast" | "crossChain" | "yieldVault";

const registries: Record<Capability, Map<ProviderId, { meta: RailProviderMeta }>> = {
  domesticFast: new Map(),
  crossChain: new Map(),
  yieldVault: new Map(),
};

/**
 * Register a provider adapter.
 *
 * Refuses an unconfigured adapter outright rather than storing it as a
 * "degraded" option. There is no useful degraded mode for moving money: an
 * adapter without credentials can only pretend.
 */
export function registerRail<T extends { meta: RailProviderMeta }>(
  capability: Capability,
  adapter: T,
): void {
  if (!adapter.meta.configured) {
    throw new IntegrationNotConfiguredError(
      `${adapter.meta.displayName} (${capability}) — missing: ${adapter.meta.missing?.join(", ") || "credentials"}`,
    );
  }
  registries[capability].set(adapter.meta.id, adapter);
}

/** Every configured provider for a capability. Empty is a legitimate answer. */
export function listRails(capability: Capability): RailProviderMeta[] {
  return [...registries[capability].values()].map((a) => a.meta);
}

/**
 * Resolve a capability, or throw.
 *
 * The throw is the point. Call sites that would otherwise reach for a mock get
 * an error naming the capability, which becomes a 503 at the route boundary —
 * an honest outage instead of an invented settlement.
 */
export function requireRail<T>(capability: Capability, providerId?: ProviderId): T {
  const reg = registries[capability];
  if (reg.size === 0) {
    throw new IntegrationNotConfiguredError(
      `no ${capability} rail is configured on this deployment`,
    );
  }
  if (providerId) {
    const found = reg.get(providerId);
    if (!found) {
      throw new IntegrationNotConfiguredError(`${capability} rail "${providerId}" is not configured`);
    }
    return found as T;
  }
  return [...reg.values()][0] as T;
}

/** Test-only: drop all registrations so suites do not leak state into each other. */
export function __resetRailsForTests(): void {
  for (const key of Object.keys(registries) as Capability[]) registries[key].clear();
}
