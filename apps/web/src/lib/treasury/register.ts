import { financialEnvironment, type FinancialEnvironment } from "@/lib/flags";

// ---------------------------------------------------------------------------
// The treasury wallet register.
//
// THE INVARIANT: FurlPay has no unknown addresses. Every address the platform
// will send to, sign for, or count as a balance is declared here with its
// chain, its purpose, its environment and who controls it. An address that is
// not in this register is not ours, whatever a config value says.
//
// WHY A REGISTER RATHER THAN ENV VARS. `TREASURY_ADDRESS_BSC` in an env file
// answers "what is the address" and none of the questions that actually matter
// during an incident: which chain, whose key, for what purpose, and may
// customer money be in it. An operator at 3am needs those, and a reconciliation
// job needs them to know which balances to sum against which liability.
//
// THE SEGREGATION RULE, which is the one this file exists to make structural:
//
//     CUSTOMER money and CORPORATE money never share a wallet.
//
// Not "should not" — cannot, because `purpose` determines `holds`, and
// `assertSegregation` refuses a movement that would mix them. If operational
// spend and customer balances share an address, "do we hold enough to pay
// everyone back" has no answer, and that question is the whole of solvency.
//
// GAS IS CORPORATE. A fee-payer wallet holds our money spent on customers'
// behalf; it must never hold customer funds, and its balance must never be
// counted toward customer liability coverage. Conflating them overstates
// solvency by exactly the gas float.
//
// EMPTY IN EVERY ENVIRONMENT TODAY. No treasury wallet has been provisioned
// under a documented control policy. Declaring plausible addresses would be
// worse than declaring none: reconciliation would sum balances at addresses
// nobody controls, and report them as coverage.
// ---------------------------------------------------------------------------

export type WalletPurpose =
  /** Customer funds held in stablecoin. The liability-backing wallet. */
  | "customer_custody"
  /** Inbound customer deposits, swept to custody after screening. */
  | "deposit_collection"
  /** Outbound customer withdrawals. Funded from custody, never from corporate. */
  | "withdrawal_hot"
  /** Gas only. CORPORATE money. Never customer funds. */
  | "gas_fee_payer"
  /** Company money: revenue, float, operating balance. */
  | "corporate_treasury"
  /** Settlement to or from a provider. */
  | "provider_settlement"
  /** Cold reserve. No automated path may spend from it. */
  | "cold_reserve";

/** Whose money can legitimately sit here. Derived, never hand-set per wallet. */
export type WalletHolds = "customer" | "corporate";

/** How signing authority over the wallet is exercised. */
export type ControlPolicy =
  /** A KMS/enclave key reachable by the application under policy. */
  | "kms_single"
  /** Multiple approvers required for any movement. */
  | "kms_multisig"
  /** An on-chain smart-account with an owner set and a threshold. */
  | "smart_account"
  /** Keys held offline; movement requires a documented manual ceremony. */
  | "offline_ceremony";

export interface TreasuryWallet {
  /** Stable internal id. Referenced by ledger postings and reconciliation. */
  readonly walletId: string;
  readonly chain: string;
  readonly address: string;
  readonly purpose: WalletPurpose;
  readonly environment: FinancialEnvironment;
  readonly control: ControlPolicy;
  /** Logical KMS key id (lib/kms.ts KEY_PURPOSES). Never key material. */
  readonly signingKeyId?: string;
  /** Who is accountable for this wallet. A wallet with no owner has no owner. */
  readonly owner: string;
  /** Assets this wallet is expected to hold. Anything else is a finding. */
  readonly expectedAssets: readonly string[];
  /**
   * Ceiling for automated movement, in minor units of the asset moved.
   *
   * null means NO automated movement is permitted — the correct setting for a
   * cold reserve, and the reason this field is not optional.
   */
  readonly autoMoveCapMinor: bigint | null;
  readonly note: string;
}

/**
 * Which side of the segregation line a purpose falls on.
 *
 * Exhaustive by construction: a new purpose will not compile until somebody
 * decides whose money it holds, which is exactly the decision that must not be
 * made by accident.
 */
export function holdsFor(purpose: WalletPurpose): WalletHolds {
  switch (purpose) {
    case "customer_custody":
    case "deposit_collection":
    case "withdrawal_hot":
      return "customer";
    case "gas_fee_payer":
    case "corporate_treasury":
    case "provider_settlement":
    case "cold_reserve":
      return "corporate";
  }
}

/**
 * The register.
 *
 * Empty. No treasury wallet has been provisioned under a documented control
 * policy in any environment. See the header for why this is not seeded.
 */
export const TREASURY_WALLETS: readonly TreasuryWallet[] = [];

// ── Lookup ─────────────────────────────────────────────────────────────────

/** Wallets declared for the CURRENT financial environment only.
 *
 *  Environment filtering is not a convenience. A staging address appearing in a
 *  production balance sum would report coverage that does not exist, and a
 *  production address reachable from staging is how a test run spends real
 *  money. */
export function walletsForEnvironment(
  env: FinancialEnvironment = financialEnvironment()
): readonly TreasuryWallet[] {
  return TREASURY_WALLETS.filter((w) => w.environment === env);
}

export function walletById(walletId: string): TreasuryWallet | undefined {
  return walletsForEnvironment().find((w) => w.walletId === walletId);
}

/** Resolve by on-chain address. Case-insensitive: EVM addresses are compared
 *  by value, and a checksum difference is not a different address. */
export function walletByAddress(chain: string, address: string): TreasuryWallet | undefined {
  const needle = address.trim().toLowerCase();
  return walletsForEnvironment().find(
    (w) => w.chain === chain && w.address.toLowerCase() === needle
  );
}

/** Is this address one of ours, in this environment? */
export function isOwnAddress(chain: string, address: string): boolean {
  return walletByAddress(chain, address) !== undefined;
}

/** Wallets whose balances back customer liability. The solvency numerator. */
export function customerBackingWallets(): readonly TreasuryWallet[] {
  return walletsForEnvironment().filter((w) => holdsFor(w.purpose) === "customer");
}

// ── Guards ─────────────────────────────────────────────────────────────────

export type TreasuryRefusal =
  | "unknown_wallet"
  | "wrong_environment"
  | "segregation_violation"
  | "asset_not_expected"
  | "automated_movement_forbidden"
  | "above_auto_move_cap";

export class TreasuryPolicyError extends Error {
  readonly reasons: readonly TreasuryRefusal[];
  constructor(detail: string, reasons: readonly TreasuryRefusal[]) {
    super(detail);
    this.name = "TreasuryPolicyError";
    this.reasons = reasons;
  }
}

export interface MovementRequest {
  readonly fromWalletId: string;
  readonly toWalletId: string;
  readonly assetId: string;
  readonly amountMinor: bigint;
  /** True when no human is approving this specific movement. */
  readonly automated: boolean;
}

export interface MovementDecision {
  readonly allowed: boolean;
  readonly reasons: readonly TreasuryRefusal[];
}

/**
 * May this internal treasury movement proceed?
 *
 * The rule that does the work is segregation: customer money and corporate
 * money may not move into each other. A sweep from a deposit wallet to custody
 * is customer→customer and fine. Paying an operating expense out of custody is
 * customer→corporate and is refused here rather than discovered in an audit.
 *
 * Fee revenue moving from customer to corporate is a real and legitimate
 * movement — but it is a LEDGER posting against fee revenue, not a wallet
 * transfer, and it must be recognised as such rather than smuggled through as
 * a treasury sweep. That is why there is no exception here.
 */
export function canMove(request: MovementRequest): MovementDecision {
  const reasons: TreasuryRefusal[] = [];

  const from = walletById(request.fromWalletId);
  const to = walletById(request.toWalletId);

  if (!from || !to) {
    // Distinguish "not ours" from "ours but elsewhere", because the remedies
    // differ: one is a typo or an attack, the other is a deployment mistake.
    const declaredAnywhere = TREASURY_WALLETS.some(
      (w) => w.walletId === request.fromWalletId || w.walletId === request.toWalletId
    );
    reasons.push(declaredAnywhere ? "wrong_environment" : "unknown_wallet");
    return { allowed: false, reasons };
  }

  if (holdsFor(from.purpose) !== holdsFor(to.purpose)) {
    reasons.push("segregation_violation");
  }

  if (!from.expectedAssets.includes(request.assetId) || !to.expectedAssets.includes(request.assetId)) {
    reasons.push("asset_not_expected");
  }

  if (request.automated) {
    if (from.autoMoveCapMinor === null) reasons.push("automated_movement_forbidden");
    else if (request.amountMinor > from.autoMoveCapMinor) reasons.push("above_auto_move_cap");
  }

  return { allowed: reasons.length === 0, reasons };
}

/** Throwing variant. Call before constructing any treasury transaction. */
export function assertCanMove(request: MovementRequest): void {
  const decision = canMove(request);
  if (!decision.allowed) {
    throw new TreasuryPolicyError(
      `Treasury movement refused (${request.fromWalletId} -> ${request.toWalletId}): ` +
        decision.reasons.join(", "),
      decision.reasons
    );
  }
}

// ── Solvency ───────────────────────────────────────────────────────────────

export interface CoverageInput {
  /** Total we owe customers, in minor units of one asset. */
  readonly customerLiabilityMinor: bigint;
  /** Observed balances at customer-backing wallets, same asset. */
  readonly backingBalances: readonly { walletId: string; minor: bigint }[];
}

export interface CoverageReport {
  readonly liabilityMinor: bigint;
  readonly backingMinor: bigint;
  /** backing - liability. Negative is a shortfall and is an incident. */
  readonly surplusMinor: bigint;
  readonly covered: boolean;
  /** Balances at wallets that are not declared customer-backing. */
  readonly ignoredWallets: readonly string[];
}

/**
 * Is customer liability actually backed?
 *
 * Counts ONLY declared customer-backing wallets. A corporate or gas balance
 * that happens to be large does not make customers whole — it is our money,
 * and counting it overstates coverage by exactly the amount least available in
 * a crisis. Undeclared wallets are reported in `ignoredWallets` rather than
 * silently dropped, because "we found a balance somewhere we do not recognise"
 * is itself a finding.
 */
export function coverage(input: CoverageInput): CoverageReport {
  const backing = customerBackingWallets().map((w) => w.walletId);
  const ignored: string[] = [];
  let total = 0n;

  for (const balance of input.backingBalances) {
    if (backing.includes(balance.walletId)) total += balance.minor;
    else ignored.push(balance.walletId);
  }

  const surplus = total - input.customerLiabilityMinor;
  return {
    liabilityMinor: input.customerLiabilityMinor,
    backingMinor: total,
    surplusMinor: surplus,
    covered: surplus >= 0n,
    ignoredWallets: ignored,
  };
}
