// ---------------------------------------------------------------------------
// The account-deletion retention model is implemented BY THE SCHEMA: deleting
// the users row is the whole operation, and what survives is decided by each
// table's foreign key. lib/accountDeletion.ts documents that contract and the
// UI/API/privacy copy promise it to users.
//
// This suite pins the contract to the migrations. If someone changes deposits
// to `on delete cascade`, or gives audit_log a foreign key, the retention model
// silently inverts — an erasure would start destroying financial and security
// evidence, and our published copy would become a lie. That must fail loudly.
//
// (Executing the cascade needs a real Postgres — see
// scripts/db/account-deletion-retention.mjs.)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../supabase/migrations"
);

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .join("\n")
  .toLowerCase();

/** The `user_id` FK clause declared by a table, if it has one. */
function userFk(table: string): string | null {
  const body = sql.match(new RegExp(`create table ${table}\\s*\\(([\\s\\S]*?)\\n\\);`))?.[1];
  if (!body) throw new Error(`table ${table} not found in migrations`);
  const line = body
    .split("\n")
    .find((l) => /\buser_id\b/.test(l) && /references\s+users/.test(l));
  return line ? line.trim() : null;
}

// Erased with the user: operational + personal data.
const CASCADE_TABLES = [
  "token_balances",
  "fiat_balances",
  "holdings",
  "cards",
  "bills",
  "transactions",
  "trips",
  "linked_wallets",
  // Contacts are third-party personal data the user entered (names paired with
  // wallet addresses). Nothing about them is a financial record of the user's
  // own activity, so there is no retention argument — they are erased outright.
  "contacts",
  // Notifications are denormalised display copy ("your deposit completed"),
  // never the record of the thing they describe — the ledger, the audit log and
  // the order store hold that, and each is classified on its own terms above.
  // So there is no retention argument here, and a positive reason to erase: an
  // erasure request that leaves "your withdrawal failed" addressed to a deleted
  // account has not erased anything the user cared about.
  "notifications",
];

describe("account deletion — retention contract (schema-enforced)", () => {
  it.each(CASCADE_TABLES)("%s is ERASED with the user (on delete cascade)", (table) => {
    const fk = userFk(table);
    expect(fk, `${table} must have a user_id FK`).not.toBeNull();
    expect(fk).toMatch(/on delete cascade/);
  });

  it("deposits are RETAINED and PSEUDONYMIZED (on delete set null)", () => {
    // The on-chain deposit ledger is the permanent record of money that
    // actually moved. Deletion detaches the subject; it must not destroy it.
    const fk = userFk("deposits");
    expect(fk).not.toBeNull();
    expect(fk).toMatch(/on delete set null/);
    expect(fk).not.toMatch(/on delete cascade/);
  });

  it("audit_log is RETAINED — no foreign key to users", () => {
    // 0002: "the trail must outlive account deletion (GDPR erasure removes the
    // user row, not the evidence that actions happened)."
    expect(userFk("audit_log")).toBeNull();
  });

  it.each(["ops_tx_events", "ops_security_events"])(
    "%s is RETAINED — no foreign key to users",
    (table) => {
      expect(userFk(table)).toBeNull();
    }
  );

  it("every user-scoped table is classified — a new one must be triaged, not defaulted", () => {
    // Guards against a table being added with a user_id FK and quietly
    // inheriting whatever cascade behavior its author happened to type.
    const declared = new Set([...CASCADE_TABLES, "deposits"]);
    const withUserFk = [...sql.matchAll(/create table (\w+)\s*\(([\s\S]*?)\n\);/g)]
      .filter(([, , body]) => /\buser_id\b[^\n]*references\s+users/.test(body))
      .map(([, table]) => table);

    const unclassified = withUserFk.filter((t) => !declared.has(t));
    expect(
      unclassified,
      `New user-scoped table(s) ${unclassified.join(", ")} — classify them in ` +
        `lib/accountDeletion.ts (erase / pseudonymize / retain) and add them here.`
    ).toEqual([]);
  });
});
