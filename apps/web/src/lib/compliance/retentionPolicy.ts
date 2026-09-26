// ---------------------------------------------------------------------------
// The data retention matrix.
//
// WHY THIS FILE CONTAINS NO RETENTION PERIODS.
//
// Every legal field below is `UNVERIFIED`, and that is the deliverable, not a
// gap in it. Retention for a regulated payments business is set by AMLD/MiCA
// transposition in each jurisdiction FurlPay operates in, by its own licensing
// conditions, and by whatever its DPA commits to. None of that is in this
// repository, and none of it can be inferred from the code.
//
// Writing "5 years" here because that is the commonly-cited AML figure would be
// the worst available outcome: it reads as researched, it would be copied into a
// privacy policy, and a deletion job built on it would destroy records the
// business is required to hold — irreversibly, and with the code's apparent
// authority behind it.
//
// So this is a STRUCTURED QUESTIONNAIRE that happens to be executable. It fixes
// the shape of the answer, names every data class that needs one, and refuses to
// let anything be deleted on a period nobody has confirmed. Legal fills in
// `legalBasis` and `retention`; `deletionImplemented` flips only when both are
// real and a job exists.
//
// WHAT IS ALREADY TRUE, INDEPENDENT OF LEGAL REVIEW.
//
// Two classes below already have working deletion because their trigger is an
// event rather than a clock: the disclosure package is destroyed the moment it
// is released or refused, and the session-scoped watch token dies on sign-out.
// Those are marked `deletionImplemented: true` and are the model for the rest.
// ---------------------------------------------------------------------------

/** A retention figure nobody has confirmed. Never a number. */
export const UNVERIFIED = "UNVERIFIED" as const;
export type Unverified = typeof UNVERIFIED;

export type DeletionTrigger =
  | "account_closure_plus_retention"
  | "immediate_on_use"
  | "immediate_on_rejection"
  | "session_end"
  | "fixed_period_from_creation"
  | typeof UNVERIFIED;

export interface RetentionRecord {
  /** Stable key for the data class. */
  id: string;
  /** What it is, in the words a DPO would use. */
  dataType: string;
  /** Why FurlPay holds it at all. Purpose limitation starts here. */
  purpose: string;
  /**
   * The lawful basis. UNVERIFIED until legal confirms — this is the field that
   * determines whether the row below it is even allowed to exist.
   */
  legalBasis: string | Unverified;
  /** Minimum hold. UNVERIFIED until legal confirms. NEVER guessed. */
  retention: string | Unverified;
  deletionTrigger: DeletionTrigger;
  /** Does a legal hold suspend deletion for this class? */
  legalHoldApplies: boolean | Unverified;
  /** Accountable team. */
  owner: string;
  /** Where the bytes actually live, as implemented today. */
  storageLocation: string;
  /** Who can read it, as enforced by code today. */
  accessRoles: string[];
  /**
   * Is automated deletion actually WIRED UP? False means the record persists
   * until someone acts, and saying so plainly is the point of the field.
   */
  deletionImplemented: boolean;
  notes?: string;
}

export const RETENTION_MATRIX: readonly RetentionRecord[] = [
  {
    id: "identity_document",
    dataType: "Travel/identity document reference",
    purpose: "KYC verification and travel eligibility checks.",
    legalBasis: UNVERIFIED,
    retention: UNVERIFIED,
    deletionTrigger: UNVERIFIED,
    legalHoldApplies: UNVERIFIED,
    owner: "Compliance",
    storageLocation: "passport store (lib/passport/store.ts)",
    accessRoles: ["owner"],
    deletionImplemented: false,
    notes:
      "Already minimised at the architecture level: only the last 4 characters " +
      "of the document number plus a verification result are stored. No image, " +
      "no MRZ, no selfie, no full number. The retention question is therefore " +
      "about a reference, not a document — which materially lowers the stakes " +
      "but does not answer it.",
  },
  {
    id: "kyc_result",
    dataType: "KYC status, tier and verifying provider",
    purpose: "Proving the account was verified, and to what level.",
    legalBasis: UNVERIFIED,
    retention: UNVERIFIED,
    deletionTrigger: "account_closure_plus_retention",
    legalHoldApplies: UNVERIFIED,
    owner: "Compliance",
    storageLocation: "account record (lib/store.ts)",
    accessRoles: ["owner", "compliance_officer"],
    deletionImplemented: false,
  },
  {
    id: "transaction_history",
    dataType: "Transaction records and ledger entries",
    purpose: "Statements, tax reporting, dispute resolution, AML monitoring.",
    legalBasis: UNVERIFIED,
    retention: UNVERIFIED,
    deletionTrigger: "account_closure_plus_retention",
    legalHoldApplies: UNVERIFIED,
    owner: "Finance / Compliance",
    storageLocation: "account record + durable ledger",
    accessRoles: ["owner", "compliance_officer"],
    deletionImplemented: false,
    notes: "Almost certainly the longest-retained class. Do not touch without legal sign-off.",
  },
  {
    id: "authority_disclosure_package",
    dataType: "Sanitised customer dossier assembled for a statutory request",
    purpose: "Responding to a verified, dual-approved legal authority request.",
    // This one IS answerable from first principles: the package is a derived
    // copy, and the source records it was built from are retained separately
    // under their own rules. Holding the copy adds risk and no obligation.
    legalBasis: "Derived copy — the source records carry the retention obligation, not this.",
    retention: "Until redeemed or refused. Never at rest beyond the workflow.",
    deletionTrigger: "immediate_on_use",
    legalHoldApplies: false,
    owner: "Compliance",
    storageLocation: "authority request record (transient)",
    accessRoles: ["disclosure token holder"],
    deletionImplemented: true,
    notes:
      "Destroyed on redemption AND on rejection. The tamper-evident audit chain " +
      "survives it — what was disclosed and by whose authority outlives the data " +
      "itself, which is the correct asymmetry.",
  },
  {
    id: "authority_audit_chain",
    dataType: "Hash-chained audit blocks for authority requests",
    purpose: "Proving who authorised a disclosure, and when.",
    legalBasis: UNVERIFIED,
    retention: UNVERIFIED,
    deletionTrigger: UNVERIFIED,
    legalHoldApplies: true,
    owner: "Compliance",
    storageLocation: "authority request record",
    accessRoles: ["compliance_officer", "admin"],
    deletionImplemented: false,
    notes:
      "Contains NO customer data — actor ids, actions, timestamps and payload " +
      "hashes only. Should almost certainly outlive everything it describes.",
  },
  {
    id: "role_grants",
    dataType: "Privileged-role grant records",
    purpose: "Proving who could access customer data, since when, and on whose authority.",
    legalBasis: UNVERIFIED,
    retention: UNVERIFIED,
    deletionTrigger: UNVERIFIED,
    legalHoldApplies: true,
    owner: "Security",
    storageLocation: "rbac grant store (lib/compliance/roleGrants.ts)",
    accessRoles: ["admin"],
    deletionImplemented: false,
    notes: "Revoked grants are RETAINED deliberately — the history is the control.",
  },
  {
    id: "security_events",
    dataType: "Security and anomaly events",
    purpose: "Incident detection and investigation.",
    legalBasis: UNVERIFIED,
    retention: UNVERIFIED,
    deletionTrigger: "fixed_period_from_creation",
    legalHoldApplies: UNVERIFIED,
    owner: "Security",
    storageLocation: "ops event store",
    accessRoles: ["admin"],
    deletionImplemented: false,
    notes: "Ring-buffered in the KV feed; the durable sink has no policy yet.",
  },
  {
    id: "watch_session_token",
    dataType: "Session JWT held on a paired Wear OS device",
    purpose: "Letting the watch reach the API when the phone is unreachable.",
    legalBasis: "Necessary for performance of the service.",
    retention: "Life of the session.",
    deletionTrigger: "session_end",
    legalHoldApplies: false,
    owner: "Engineering",
    storageLocation: "Android Keystore on the watch",
    accessRoles: ["device holder"],
    deletionImplemented: true,
    notes:
      "Cleared on sign-out along with every cached snapshot derived from it. " +
      "The clear path is deliberately NOT gated on paired-node verification: " +
      "ending a session must never be blocked by a check that granting it needs.",
  },
  {
    id: "support_conversations",
    dataType: "Support tickets and messages",
    purpose: "Customer service and dispute history.",
    legalBasis: UNVERIFIED,
    retention: UNVERIFIED,
    deletionTrigger: UNVERIFIED,
    legalHoldApplies: UNVERIFIED,
    owner: "Support",
    storageLocation: "ticket store",
    accessRoles: ["owner", "admin"],
    deletionImplemented: false,
  },
] as const;

/** Classes still waiting on legal. The work queue, generated rather than listed. */
export function unverifiedRetention(): RetentionRecord[] {
  return RETENTION_MATRIX.filter(
    (r) => r.legalBasis === UNVERIFIED || r.retention === UNVERIFIED
  );
}

/**
 * May an automated job delete this class?
 *
 * The guard that makes the honesty above load-bearing rather than decorative.
 * Any deletion machinery MUST call this first: a class whose legal basis or
 * retention period is unconfirmed can never be swept, whatever a scheduler
 * believes. An event-triggered class (`immediate_on_use`, `session_end`) is
 * exempt because its trigger is not a clock — nothing is being guessed.
 */
export function mayAutoDelete(record: RetentionRecord): boolean {
  if (record.deletionTrigger === "immediate_on_use") return true;
  if (record.deletionTrigger === "immediate_on_rejection") return true;
  if (record.deletionTrigger === "session_end") return true;
  return record.legalBasis !== UNVERIFIED && record.retention !== UNVERIFIED;
}
