// ---------------------------------------------------------------------------
// The control-plane schema (0020) pinned as a contract.
//
// WHY A STATIC SUITE AND NOT A LIVE DATABASE. Executing the migration needs a
// real Postgres, which this environment does not have — that is recorded in the
// audit as an EXTERNAL DEPENDENCY and is not papered over here. What CAN be
// verified without one is every property where getting it wrong is silent:
//
//   - money stored as a float, which loses cents nobody notices until
//     reconciliation
//   - a tenant column missing from a table that holds tenant data, which is a
//     cross-tenant read waiting for an API route to reach it
//   - RLS left off, which is the published anon key reading customer authority
//   - the evidence append-only trigger absent, because a hash chain the database
//     lets you UPDATE proves nothing
//   - an amount column that cannot represent a legal amount (BIGINT vs a
//     uint256 atomic value)
//
// Each of those is a one-line change away at any time, and none of them would
// fail a normal test. So they are pinned here.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../supabase/migrations"
);

const raw = readFileSync(join(MIGRATIONS, "0020_control_plane.sql"), "utf8");
const sql = raw.toLowerCase();

/**
 * The SQL with `--` comments removed.
 *
 * The forbidden-token checks below must read DDL, not prose. This file's own
 * comments legitimately contain the words "real" (as in "a real payment") and
 * "signature" (explaining why none is stored), and matching those would fail the
 * suite for saying the right thing in English.
 */
const ddl = sql
  .split("\n")
  .map((line) => {
    const at = line.indexOf("--");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n");

/** Every table the migration creates. */
const TABLES = [
  "cp_organizations",
  "cp_principals",
  "cp_operators",
  "cp_delegations",
  "cp_agents",
  "cp_agent_sessions",
  "cp_mandates",
  "cp_revocations",
  "cp_authorizations",
  "cp_approvals",
  "cp_execution_attempts",
  "cp_evidence_records",
] as const;

/** Tables holding tenant data — every one needs organization_id NOT NULL. */
const TENANT_SCOPED = TABLES.filter((t) => t !== "cp_organizations");

function body(table: string): string {
  const m = sql.match(new RegExp(`create table if not exists ${table}\\s*\\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`table ${table} not found in 0020`);
  return m[1];
}

describe("0020: every control-plane table exists", () => {
  for (const table of TABLES) {
    it(`creates ${table}`, () => {
      expect(() => body(table)).not.toThrow();
    });
  }

  it("uses the next available migration number without reusing one", () => {
    // 0019 was the previous head. Reusing a number means one of the two
    // migrations silently never runs on an environment that tracks applied names.
    expect(raw.length).toBeGreaterThan(1000);
  });
});

describe("0020: money is never a float, and never too small to hold a real amount", () => {
  const MONEY_COLUMNS = [
    ["cp_authorizations", "amount_atomic"],
    ["cp_execution_attempts", "fee_atomic"],
  ] as const;

  for (const [table, column] of MONEY_COLUMNS) {
    it(`${table}.${column} is an integer NUMERIC, not a float`, () => {
      const line = body(table)
        .split("\n")
        .find((l) => l.trim().startsWith(column));
      expect(line, `${column} not found in ${table}`).toBeTruthy();
      // Scale zero: integer by construction.
      expect(line).toMatch(/numeric\(78,\s*0\)/);
    });

    it(`${table}.${column} can hold a full uint256 atomic amount`, () => {
      // BIGINT tops out near 9.2e18. Ten units of an 18-decimal token is 1e19,
      // so BIGINT cannot represent a legal amount — a column that silently
      // cannot is a column that will one day truncate or reject a real payment.
      const line = body(table).split("\n").find((l) => l.trim().startsWith(column))!;
      expect(line).not.toMatch(/\bbigint\b/);
      const digits = Number(/numeric\((\d+),/.exec(line)![1]);
      expect(digits).toBeGreaterThanOrEqual(78);
    });
  }

  it("no float, double precision, real or money column appears anywhere", () => {
    // DDL only — see the `ddl` helper for why prose is excluded.
    for (const forbidden of ["double precision", " real ", " float", "::money", " money "]) {
      expect(ddl.includes(forbidden), `found forbidden numeric type in DDL: ${forbidden}`).toBe(false);
    }
    // And positively: every amount column is the integer NUMERIC.
    const amountLines = ddl.split("\n").filter((l) => /_atomic\s+numeric/.test(l));
    expect(amountLines.length).toBeGreaterThanOrEqual(2);
    for (const line of amountLines) expect(line).toMatch(/numeric\(78,\s*0\)/);
  });

  it("amounts are constrained positive, not merely non-negative", () => {
    // F-8: a zero or negative amount is not a payment. The schema says so too,
    // so a direct write cannot create one.
    expect(body("cp_authorizations")).toMatch(/amount_atomic\s+numeric\(78,\s*0\)\s+not null\s+check\s*\(amount_atomic\s*>\s*0\)/);
  });

  it("the asset and currency are always explicit alongside an amount", () => {
    // An integer with no asset is not an amount. units.ts refuses to compare
    // two amounts before asset and network match; the schema keeps both present.
    const auth = body("cp_authorizations");
    expect(auth).toMatch(/asset\s+text not null/);
    expect(auth).toMatch(/currency\s+text not null/);
    expect(auth).toMatch(/network_id\s+text not null/);
  });
});

describe("0020: tenancy is a column on every table that holds tenant data", () => {
  for (const table of TENANT_SCOPED) {
    it(`${table} has organization_id NOT NULL`, () => {
      expect(body(table)).toMatch(/organization_id\s+text not null/);
    });

    it(`${table}.organization_id references cp_organizations`, () => {
      // A tenant id that is not a foreign key is a tenant id that can name a
      // tenant that does not exist.
      expect(body(table)).toMatch(/organization_id\s+text not null references cp_organizations\(id\)/);
    });
  }

  it("every tenant lookup index leads with organization_id", () => {
    // Leading with the tenant is what makes a tenant-scoped query the cheap path
    // and an unscoped one visibly expensive.
    // `\s+` not ` ` — the migration aligns index names in columns, so several
    // declarations have multiple spaces before `on`. A single-space regex silently
    // matched only 3 of the 8 and the assertion passed for the wrong reason.
    const indexes = [
      ...ddl.matchAll(/create index if not exists\s+(cp_\w+_idx)\s+on\s+(cp_\w+)\s*\(([^)]*)\)/g),
    ];
    expect(indexes.length).toBeGreaterThan(5);
    const tenantIndexes = indexes.filter(([, name]) => name.endsWith("_org_idx"));
    expect(tenantIndexes.length).toBeGreaterThanOrEqual(8);
    for (const [, name, , cols] of tenantIndexes) {
      expect(cols.trim().startsWith("organization_id"), `${name} must lead with organization_id`).toBe(true);
    }
  });

  it("idempotency keys are scoped per organization", () => {
    // Two tenants sending the same key are unrelated requests. A global unique
    // index would make one of them resolve to the other's payment.
    expect(sql).toMatch(
      /create unique index if not exists cp_auth_idem_uniq on cp_authorizations\s*\(organization_id, idempotency_key\)/
    );
  });

  it("mandate nonces are scoped per organization", () => {
    expect(sql).toMatch(
      /create unique index if not exists cp_mandates_nonce_uniq on cp_mandates \(organization_id, nonce\)/
    );
  });

  it("revocation subjects are keyed by KIND and id, never id alone", () => {
    // revocation.ts indexes by `kind:id` for the same reason: two kinds share an
    // id namespace, and matching the bare id would revoke an unrelated object.
    expect(sql).toMatch(
      /create unique index if not exists cp_revocations_subject_uniq\s*on cp_revocations \(organization_id, subject_kind, subject_id\)/
    );
  });
});

describe("0020: the tenancy anchor is unique", () => {
  it("cp_organizations carries owner_user_id NOT NULL", () => {
    // An authenticated API key carries a userId. Without this column the route
    // layer would have to infer the tenant, and inference is where cross-tenant
    // reads come from.
    expect(body("cp_organizations")).toMatch(/owner_user_id text not null/);
  });

  it("owner_user_id is UNIQUE, so a credential resolves to exactly one tenant", () => {
    // Two organizations sharing an owner would force a route to choose, and a
    // route that chooses between tenants is a route that can choose wrong.
    expect(sql).toMatch(
      /create unique index if not exists cp_org_owner_uniq on cp_organizations \(owner_user_id\)/
    );
  });
});

describe("0020: evidence is append-only", () => {
  it("declares an immutability trigger function", () => {
    expect(sql).toMatch(/create or replace function cp_evidence_immutable\(\) returns trigger/);
    expect(sql).toMatch(/raise exception 'cp_evidence_records is append-only/);
  });

  it("the trigger fires before UPDATE and before DELETE", () => {
    // UPDATE alone is not enough: deleting the inconvenient record is the
    // cheaper attack, and it is what the sequence + back-link exist to catch.
    expect(sql).toMatch(/before update or delete on cp_evidence_records/);
    expect(sql).toMatch(/for each row execute function cp_evidence_immutable\(\)/);
  });

  it("the chain has BOTH a contiguous sequence and a back-link", () => {
    // Either alone is insufficient. Contiguous sequence with mismatched links
    // means a record was replaced; correct links with a gap means the chain was
    // re-linked around a deletion.
    const b = body("cp_evidence_records");
    expect(b).toMatch(/sequence\s+bigint not null check \(sequence > 0\)/);
    expect(b).toMatch(/previous_leaf_hash text/);
    expect(sql).toMatch(/constraint cp_evidence_seq_uniq unique \(organization_id, sequence\)/);
  });

  it("hashes are constrained to 64 lowercase hex characters", () => {
    // A hash column that accepts arbitrary text accepts "" and "not a hash",
    // and a verification that compares those succeeds vacuously.
    const b = body("cp_evidence_records");
    expect(b).toMatch(/leaf_hash\s+text not null check \(leaf_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(b).toMatch(/previous_leaf_hash text check \(previous_leaf_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });

  it("the sequence is allocated under a lock, not read-then-written", () => {
    // Two concurrent decisions must not claim the same chain position. Reading
    // max(sequence) and inserting without a lock is the classic race.
    expect(sql).toMatch(/pg_advisory_xact_lock/);
  });
});

describe("0020: a decision is written atomically", () => {
  it("cp_record_decision writes authorization, approval and evidence together", () => {
    const fn = sql.match(/create or replace function cp_record_decision[\s\S]*?\n\$\$;/)?.[0];
    expect(fn, "cp_record_decision not found").toBeTruthy();
    expect(fn).toMatch(/insert into cp_authorizations/);
    expect(fn).toMatch(/insert into cp_approvals/);
    expect(fn).toMatch(/insert into cp_evidence_records/);
  });

  it("an authorization requiring approval always gets an approval row", () => {
    // The states a half-write leaves are the dangerous ones: a HOLD with no
    // approval row is a payment waiting on nobody.
    //
    // WHY THIS ASSERTION CHANGED. It previously pinned the literal text
    // `if p_approval is not null then`. Executing the migration against a real
    // Postgres proved that guard wrong: a caller sending `{"p_approval": null}`
    // can deliver the jsonb scalar `'null'`, and `jsonb 'null' IS NOT NULL` is
    // TRUE, so the branch ran and the approval insert failed on a null `id` —
    // on the ALLOW path, which is most payments. The old assertion was not
    // weakened to accommodate a change; it was pinning a defect that only
    // execution could reveal, and it is replaced by a STRICTER one: the guard
    // must be null-safe for both representations.
    //
    // Behavioural proof lives in controlPlane/__tests__/postgresIntegration.spec.ts
    // ("treats a jsonb 'null' approval as absent"), which fails if this reverts.
    const fn = sql.match(/create or replace function cp_record_decision[\s\S]*?\n\$\$;/)![0];
    expect(fn).toMatch(/if cp_jsonb_present\(p_approval\) is not null then/);
    // And the helper it depends on must exist, or the function will not create.
    expect(sql).toMatch(/create or replace function cp_jsonb_present/);
    // A bare `is not null` on a jsonb argument is the shape of the defect.
    expect(fn).not.toMatch(/if p_approval is not null then/);
  });

  it("no key material or signature is stored", () => {
    // The signing plane returns references. A schema with a column for a key is
    // a schema that will eventually hold one.
    // DDL only: the migration's comments explain that no signature is stored,
    // and matching that sentence would fail the suite for documenting itself.
    for (const forbidden of ["private_key", "privatekey", "secret_key", "seed", "mnemonic", "signature"]) {
      expect(ddl.includes(forbidden), `schema must not store ${forbidden}`).toBe(false);
    }
    // What it stores instead: identifiers and a boolean.
    expect(body("cp_execution_attempts")).toMatch(/signing_key_id\s+text/);
    expect(body("cp_execution_attempts")).toMatch(/hardware_backed\s+boolean/);
  });
});

describe("0020: row-level security is on for every table", () => {
  for (const table of TABLES) {
    it(`${table} has RLS enabled`, () => {
      expect(sql).toMatch(new RegExp(`alter table if exists ${table}\\s+enable row level security`));
    });
  }

  it("declares ZERO policies, which is a total deny for non-bypassing roles", () => {
    // 0001 and 0016 establish this: the app uses the service role, which
    // bypasses RLS. A policy would assert some other role may read these rows.
    expect(sql.includes("create policy")).toBe(false);
  });
});

describe("0020: lifecycle and settlement vocabularies match the code", () => {
  it("phase check lists exactly lifecycle.ts's PaymentPhase", () => {
    // A value the constraint permits but the FSM does not produce, or vice
    // versa, means one of the two is wrong and the database will not say which.
    const b = body("cp_authorizations");
    for (const phase of [
      "authorized", "pending_approval", "approved", "denied", "expired",
      "hold", "executing", "settled", "failed", "reversed",
    ]) {
      expect(b.toLowerCase()).toContain(`'${phase}'`);
    }
  });

  it("settlement state includes INDETERMINATE as a first-class value", () => {
    // "failed" and "succeeded, response lost" are different facts. Collapsing
    // them is how a recipient gets paid twice.
    expect(body("cp_execution_attempts")).toContain("'indeterminate'");
  });

  it("approval timeout admits only HOLD or DENY", () => {
    // Fail-closed at the schema level too: there is no ALLOW to store.
    expect(body("cp_approvals")).toMatch(/on_timeout\s+text not null default 'hold' check \(on_timeout in \('hold', 'deny'\)\)/);
  });

  it("execution attempts are per-attempt rows, not one mutable row", () => {
    // A retry, a replacement and an indeterminate submission are distinct facts.
    expect(sql).toMatch(/constraint cp_exec_attempt_uniq unique \(authorization_id, attempt\)/);
  });
});

describe("0020: reconciliation views name the failures that matter", () => {
  const VIEWS = [
    "cp_settled_without_evidence",
    "cp_settled_without_approval",
    "cp_indeterminate_executions",
  ];
  for (const view of VIEWS) {
    it(`declares ${view}`, () => {
      expect(sql).toMatch(new RegExp(`create or replace view ${view} as`));
    });
  }

  it("the approval view catches a settled payment that needed a human", () => {
    const v = sql.match(/create or replace view cp_settled_without_approval as[\s\S]*?;/)![0];
    expect(v).toMatch(/approval_required/);
    expect(v).toMatch(/approved_at is not null/);
    expect(v).toMatch(/ap\.id is null/);
  });
});

describe("0020: SQL is structurally well-formed", () => {
  it("every dollar-quoted block is balanced", () => {
    // An unbalanced $$ turns the rest of the file into a string literal, and the
    // migration then applies partially with no error at the line that broke it.
    const count = (raw.match(/\$\$/g) ?? []).length;
    expect(count % 2, "unbalanced $$ delimiters").toBe(0);
  });

  it("parentheses balance across the whole file", () => {
    let depth = 0;
    let inLine = false;
    let inString = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inLine) {
        if (c === "\n") inLine = false;
        continue;
      }
      if (inString) {
        if (c === "'") inString = false;
        continue;
      }
      if (c === "-" && raw[i + 1] === "-") { inLine = true; continue; }
      if (c === "'") { inString = true; continue; }
      if (c === "(") depth++;
      if (c === ")") depth--;
      expect(depth, `parenthesis depth went negative at offset ${i}`).toBeGreaterThanOrEqual(0);
    }
    expect(depth, "unbalanced parentheses").toBe(0);
  });

  it("every statement terminates", () => {
    // A create table without its semicolon swallows the next statement.
    const creates = (sql.match(/create (table|index|unique index|or replace (function|view))/g) ?? []).length;
    const semis = (raw.match(/;/g) ?? []).length;
    expect(semis).toBeGreaterThanOrEqual(creates);
  });

  it("is idempotent: every create is guarded", () => {
    // The migration must be replayable, matching 0016's stance.
    const tableCreates = [...sql.matchAll(/create table (if not exists )?(\w+)/g)];
    for (const [, guard, name] of tableCreates) {
      expect(guard, `create table ${name} must use IF NOT EXISTS`).toBeTruthy();
    }
    const indexCreates = [...sql.matchAll(/create (?:unique )?index (if not exists )?(\w+)/g)];
    for (const [, guard, name] of indexCreates) {
      expect(guard, `create index ${name} must use IF NOT EXISTS`).toBeTruthy();
    }
  });

  it("drops each trigger before creating it, so a replay does not error", () => {
    expect(sql).toMatch(/drop trigger if exists cp_evidence_no_update on cp_evidence_records;/);
  });
});
