import { sbSelect, sbUpsert, sbUpdate } from "@/lib/supabase";
import {
  evmAddressValidator,
  networkSpec,
  verifyRecipient,
  trustClassFor,
  type AttestationMethod,
  type AttestedDestination,
  type RecipientRecord,
  type RecipientVerdict,
} from "@furlpay/control-plane";
import { controlPlaneDurable } from "./store";

// ---------------------------------------------------------------------------
// The attested-recipient store (schema: migrations/0021).
//
// WHAT CHANGED AND WHAT DID NOT. The decision logic is `verifyRecipient()` in
// the pure package, unchanged and already covered by its own tests. This file
// only READS the attestations that logic needs. Putting the judgement here
// instead would mean a second recipient check existed, and the two would
// eventually disagree under an input nobody enumerated.
//
// CANONICALISATION HAPPENS ONCE, HERE, ON BOTH SIDES. The address from the
// request and the address from the database go through the SAME function before
// they are compared. Two normalisers is the standard way a case-confusion bug
// gets in: one side lowercases, the other trims, and an attacker finds the gap.
//
// A READ FAILURE IS NOT AN ABSENT RECIPIENT. `null` here means "the store could
// not answer", and the caller turns that into a refusal. If it returned "no such
// recipient" the payment would be denied for the wrong reason today and, worse,
// an outage would look identical to a deliberate block.
// ---------------------------------------------------------------------------

export interface RecipientLookup {
  readonly record: RecipientRecord | null;
  readonly seenBefore: boolean;
}

interface RecipientRow {
  id: string;
  organization_id: string;
  display_name: string;
  verified_domain: string | null;
  status: "ACTIVE" | "BLOCKED" | "PENDING";
  mcc: string | null;
  jurisdiction: string | null;
  first_seen_at: string;
}

interface DestinationRow {
  recipient_id: string;
  network_id: string;
  asset: string;
  address_canonical: string;
  address_display: string;
  method: AttestationMethod;
  provenance: string | null;
  attested_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

/**
 * The one canonical form. Used for storage, for lookup, and for comparison.
 *
 * EVM addresses are case-insensitive on-chain, and EIP-55 encodes a checksum in
 * the case — so `0xAbC…` and `0xabc…` are the SAME account and must compare
 * equal. Non-EVM families are case-SENSITIVE (a Solana base58 address is not the
 * same account when lowercased), so only whitespace is stripped there. Getting
 * this backwards in either direction is a real vulnerability: lowercasing a
 * Solana address would make two different accounts look identical.
 */
export function canonicalAddress(address: string, networkId: string): string {
  const trimmed = address.trim();
  const spec = networkSpec(networkId);
  if (spec?.family === "evm") return trimmed.toLowerCase();
  return trimmed;
}

async function optional<T>(work: () => Promise<T>): Promise<T | null> {
  if (!controlPlaneDurable()) return null;
  try {
    return await work();
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (message.includes("PGRST205") || message.includes("does not exist")) return null;
    throw e;
  }
}

const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

/**
 * Load a recipient and its live attestations.
 *
 * Revoked destinations are excluded IN THE QUERY rather than filtered after, so
 * a revoked address is not briefly present in memory next to the comparison that
 * would accept it.
 */
export async function loadRecipient(
  organizationId: string,
  recipientId: string
): Promise<RecipientLookup | null> {
  return optional(async () => {
    const rows = await sbSelect<RecipientRow>(
      "cp_recipients",
      `organization_id=${eq(organizationId)}&id=${eq(recipientId)}&limit=1`
    );
    const row = rows[0];
    if (!row) return { record: null, seenBefore: false };

    const [destinations, settled] = await Promise.all([
      sbSelect<DestinationRow>(
        "cp_recipient_destinations",
        `organization_id=${eq(organizationId)}&recipient_id=${eq(recipientId)}` +
          `&revoked_at=is.null&limit=500`
      ),
      // First use is derived from SETTLED payments only. Deriving it from
      // authorizations would let an attacker turn a destination into
      // "seen before" using requests that were all denied.
      sbSelect<{ settled_count: number }>(
        "cp_recipient_settled",
        `organization_id=${eq(organizationId)}&recipient_id=${eq(recipientId)}&limit=1`
      ),
    ]);

    const record: RecipientRecord = {
      recipientId: row.id,
      organizationId: row.organization_id,
      displayName: row.display_name,
      verifiedDomain: row.verified_domain ?? undefined,
      status: row.status,
      firstSeenAt: row.first_seen_at,
      mcc: row.mcc ?? undefined,
      jurisdiction: row.jurisdiction ?? undefined,
      destinations: destinations.map(
        (d): AttestedDestination => ({
          networkId: d.network_id,
          asset: d.asset,
          address: d.address_canonical,
          method: d.method,
          attestedAt: d.attested_at,
          expiresAt: d.expires_at ?? undefined,
          provenance: d.provenance ?? undefined,
        })
      ),
    };

    return { record, seenBefore: Number(settled[0]?.settled_count ?? 0) > 0 };
  });
}

export interface RecipientCheckInput {
  readonly organizationId: string;
  readonly recipientId: string;
  readonly destination?: string;
  readonly domain?: string;
  readonly networkId: string;
  readonly asset: string;
  readonly amountAtomic: string;
  readonly nowMs?: number;
  /** Production refuses testnets by inspection. */
  readonly requireMainnet: boolean;
}

/**
 * Verify a payment's destination against what the recipient was attested for.
 *
 * Every failure path returns a DENIAL, never a pass. The two that are easy to
 * get wrong:
 *   · store unreachable  → `recipient_unknown`, because we genuinely do not know
 *   · no destination given → `destination_not_attested`, because a payment with
 *     no address cannot have had its address checked
 */
export async function checkRecipient(input: RecipientCheckInput): Promise<RecipientVerdict> {
  const nowMs = input.nowMs ?? Date.now();

  const lookup = await loadRecipient(input.organizationId, input.recipientId);
  if (lookup === null) {
    return {
      ok: false,
      reason: "recipient_unknown",
      detail:
        "the attested-recipient store is unavailable, so no destination can be verified; " +
        "authorization is refused rather than recording a check that did not happen",
      firstUse: true,
    };
  }

  if (!input.destination) {
    return {
      ok: false,
      reason: "destination_not_attested",
      detail: "the payment names no destination address, so no attestation can match it",
      firstUse: !lookup.seenBefore,
    };
  }

  return verifyRecipient({
    assertion: {
      destination: canonicalAddress(input.destination, input.networkId),
      networkId: input.networkId,
      asset: input.asset,
      domain: input.domain,
    },
    record: lookup.record,
    amountAtomic: input.amountAtomic,
    validators: [evmAddressValidator],
    nowMs,
    requireMainnet: input.requireMainnet,
    seenBefore: lookup.seenBefore,
  });
}

// ── Writes ─────────────────────────────────────────────────────────────────

export interface UpsertRecipientInput {
  readonly organizationId: string;
  readonly recipientId: string;
  readonly displayName: string;
  readonly status?: "ACTIVE" | "BLOCKED" | "PENDING";
  readonly mcc?: string;
  readonly jurisdiction?: string;
}

/**
 * Create or refresh a recipient.
 *
 * AN UPSERT, NOT AN INSERT. Creating the same recipient twice is ordinary
 * client behaviour — a retry after a timeout, an operator re-running a setup
 * script — and a plain INSERT answered that with a 23505 that surfaced as a
 * 500. A conflict on a request whose intent is already satisfied is not an
 * error, and reporting one trains callers to ignore errors.
 */
export async function upsertRecipient(input: UpsertRecipientInput): Promise<boolean> {
  const result = await optional(async () => {
    await sbUpsert("cp_recipients", {
      id: input.recipientId,
      organization_id: input.organizationId,
      display_name: input.displayName,
      // PENDING by default. A recipient is not payable the moment it is named;
      // it becomes payable when a destination is attested and an operator
      // activates it. Defaulting to ACTIVE would make creation itself an
      // authorization decision.
      status: input.status ?? "PENDING",
      mcc: input.mcc ?? null,
      jurisdiction: input.jurisdiction ?? null,
    });
    return true;
  });
  return result ?? false;
}

export interface AttestInput {
  readonly organizationId: string;
  readonly recipientId: string;
  readonly networkId: string;
  readonly asset: string;
  readonly address: string;
  readonly method: AttestationMethod;
  readonly provenance: string;
  readonly expiresAt?: string;
}

/**
 * Record an attestation.
 *
 * The API surface deliberately exposes ONLY `human_confirmed` — an enterprise
 * allowlist entry. `domain_signature`, `well_known` and `penny_drop` assert that
 * FurlPay performed a check that could have failed, and there is no such checker
 * yet; letting a caller name one of those methods over HTTP would let a request
 * manufacture the strongest trust class in the system. Provenance is recorded so
 * the row names who vouched.
 */
export async function attestDestination(input: AttestInput): Promise<boolean> {
  const canonical = canonicalAddress(input.address, input.networkId);
  const result = await optional(async () => {
    // Upserted on the identity index (org, recipient, network, asset, address).
    // Re-attesting the same destination refreshes it rather than creating a
    // second row — two rows for one fact is how a revocation revokes one and
    // leaves the other live.
    //
    // `revoked_at` is deliberately NOT in this payload, so a merge cannot clear
    // it. Re-attesting a revoked address must not silently un-revoke it: that
    // would turn "attest again" into a revocation bypass anyone with create
    // permission could use.
    await sbUpsert("cp_recipient_destinations", {
      organization_id: input.organizationId,
      recipient_id: input.recipientId,
      network_id: input.networkId,
      asset: input.asset.toUpperCase(),
      address_canonical: canonical,
      address_display: input.address.trim(),
      method: input.method,
      provenance: input.provenance,
      expires_at: input.expiresAt ?? null,
    });
    return true;
  });
  return result ?? false;
}

/**
 * Revoke an attestation. Not a delete.
 *
 * The row survives so "was this address trusted when that payment was
 * authorized?" stays answerable — which is precisely the question an incident
 * asks, and precisely the one a DELETE makes unanswerable.
 */
export async function revokeDestination(input: {
  organizationId: string;
  recipientId: string;
  networkId: string;
  asset: string;
  address: string;
  reason: string;
  revokedBy: string;
}): Promise<boolean> {
  const canonical = canonicalAddress(input.address, input.networkId);
  const updated = await optional(() =>
    sbUpdate<{ revoked_at: string }>(
      "cp_recipient_destinations",
      `organization_id=${eq(input.organizationId)}&recipient_id=${eq(input.recipientId)}` +
        `&network_id=${eq(input.networkId)}&asset=${eq(input.asset.toUpperCase())}` +
        `&address_canonical=${eq(canonical)}&revoked_at=is.null`,
      {
        revoked_at: new Date().toISOString(),
        revoked_reason: input.reason,
        revoked_by: input.revokedBy,
      } as never
    )
  );
  return (updated?.length ?? 0) > 0;
}

export { trustClassFor };
