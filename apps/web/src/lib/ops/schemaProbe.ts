import { sbRpc, supabaseBackend, SupabaseFunctionMissing } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Does the database this deployment is pointed at actually have the constraints
// the application relies on for correctness?
//
// Some safety properties here are enforced by Postgres, not by TypeScript. The
// clearest is dividend settlement: the route writes the settlement record
// before crediting cash, and relies on UNIQUE (user_id, corporate_action_id)
// to make two concurrent runs collide instead of both paying out.
//
// That is the right design — a database constraint is the only thing that holds
// under concurrency across serverless instances. But it means correctness is
// contingent on a migration having been applied, and nothing verified that.
//
// The failure is silent by construction. Without the constraint the code still
// runs, the suite still passes (tests issue one request at a time), and the
// only symptom is a double credit under concurrency, found — if ever — during
// reconciliation, after the money moved.
//
// ── WHY "unverified" IS A DISTINCT STATUS ──────────────────────────────────
//
// The obvious mistake is to treat "the check could not run" as "the check
// passed". If migration 0017 has not been applied the RPC does not exist, and
// reporting that as operational would be worse than having no probe at all: it
// converts an unknown into a false assurance, on exactly the question the probe
// was added to answer. So a missing RPC, a permission error and a network
// failure all report `unverified`, never `operational`.
//
// Only three things produce `operational`: the RPC ran, returned, and returned
// an empty list.
// ---------------------------------------------------------------------------

export type SchemaProbeStatus = "operational" | "down" | "unverified" | "not_configured";

export interface MissingConstraint {
  constraint: string;
  table: string;
  purpose: string;
}

export interface SchemaProbeResult {
  status: SchemaProbeStatus;
  /** Populated only when status is "down". */
  missing?: MissingConstraint[];
  detail?: string;
}

/** Row shape returned by furlpay_missing_constraints() (0017). */
interface MissingRow {
  constraint_name: string;
  table_name: string;
  purpose: string;
}

/** The RPC defined by supabase/migrations/0017_schema_assertions.sql. */
export const SCHEMA_ASSERTION_FN = "furlpay_missing_constraints";

export async function probeRequiredConstraints(): Promise<SchemaProbeResult> {
  if (supabaseBackend !== "supabase") {
    // No Postgres at all — the in-memory demo store. There is no constraint to
    // assert, and claiming one is present would be a lie in the other
    // direction.
    return { status: "not_configured", detail: "No Supabase backend configured." };
  }

  let rows: MissingRow[];
  try {
    rows = (await sbRpc<MissingRow[]>(SCHEMA_ASSERTION_FN, {})) ?? [];
  } catch (e) {
    if (e instanceof SupabaseFunctionMissing) {
      return {
        status: "unverified",
        detail:
          `${SCHEMA_ASSERTION_FN}() is missing — apply ` +
          "supabase/migrations/0017_schema_assertions.sql. Until then the " +
          "constraints behind dividend and reorg settlement idempotency are " +
          "UNVERIFIED in this environment, not known-good.",
      };
    }
    return {
      status: "unverified",
      detail: `Constraint check failed to run: ${(e as Error).message.slice(0, 160)}`,
    };
  }

  if (rows.length === 0) return { status: "operational" };

  const missing = rows.map((r) => ({
    constraint: r.constraint_name,
    table: r.table_name,
    purpose: r.purpose,
  }));

  return {
    status: "down",
    missing,
    detail:
      `${missing.length} required constraint(s) absent: ` +
      missing.map((m) => `${m.table}.${m.constraint}`).join(", ") +
      ". Settlement idempotency is NOT enforced by the database in this environment.",
  };
}
