import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Every table in this database must be unreachable with the anon key.
//
// THE GAP THIS CLOSES. 0001_init.sql sets the pattern and says so in a comment:
// "Service-role-only access: RLS on, zero policies. PostgREST with the service
// key bypasses RLS; the anon key gets nothing."
//
// Seven tables added in later migrations never got that line — payments,
// payment_events, the three ledger tables, and the two financial_transaction
// tables. Supabase grants `anon` and `authenticated` access to the public
// schema, and the anon key is published by design: it ships inside clients. With
// RLS off, `/rest/v1/ledger_postings?select=*` was served to it.
//
// A comment cannot enforce a convention across migrations nobody has written
// yet. This test can. It parses the migration directory and fails when a new
// table arrives without RLS — at the moment the migration is authored, rather
// than after it has been applied to production.
//
// WHAT THIS IS NOT. It reads SQL text; it does not connect to a database. It
// proves the migrations SAY the right thing. Whether they have been APPLIED to
// staging and production is an operational fact this cannot see, and the audit
// records it as requiring external verification.
// ---------------------------------------------------------------------------

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");

function sql(): { file: string; text: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(MIGRATIONS, f), "utf8") }));
}

/** Strips `--` line comments so prose describing a table is not read as DDL. */
function code(text: string): string {
  return text
    .split("\n")
    .map((l) => {
      const i = l.indexOf("--");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");
}

function tablesCreated(): Map<string, string> {
  const out = new Map<string, string>();
  for (const { file, text } of sql()) {
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code(text)))) {
      if (!out.has(m[1])) out.set(m[1], file);
    }
  }
  return out;
}

function rlsEnabled(): Set<string> {
  const out = new Set<string>();
  for (const { text } of sql()) {
    const re =
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code(text)))) out.add(m[1]);
  }
  return out;
}

/**
 * Tables that legitimately hold no customer data and are read by the browser.
 *
 * An allowlist, not a denylist, and deliberately empty at the time of writing:
 * every table in this database is currently service-role-only. Anything added
 * here needs a reason in the comment, because the entry is the exemption.
 */
const PUBLIC_READ_BY_DESIGN: ReadonlySet<string> = new Set([]);

describe("RLS coverage", () => {
  it("finds the migration directory and some tables", () => {
    // Guards the guard. A path typo would make every assertion below vacuous —
    // zero tables found, nothing to complain about, green suite.
    const created = tablesCreated();
    expect(created.size, "no CREATE TABLE found — the parser or the path is wrong").toBeGreaterThan(20);
  });

  it("every table has row level security enabled", () => {
    const created = tablesCreated();
    const rls = rlsEnabled();

    const unprotected = [...created.entries()]
      .filter(([t]) => !rls.has(t) && !PUBLIC_READ_BY_DESIGN.has(t))
      .map(([t, file]) => `${t} (created in ${file})`);

    expect(
      unprotected,
      "These tables are reachable with the PUBLISHED anon key. Add " +
        "`alter table <t> enable row level security;` in a migration, following " +
        "the service-role-only pattern documented in 0001_init.sql."
    ).toEqual([]);
  });

  it("the money tables specifically are covered", () => {
    // Named explicitly as well as caught by the sweep above. These seven were the
    // actual finding, and naming them means a future refactor that loses the
    // generic check still fails here.
    const rls = rlsEnabled();
    for (const table of [
      "payments",
      "payment_events",
      "ledger_accounts",
      "ledger_transactions",
      "ledger_postings",
      "financial_transactions",
      "financial_transaction_events",
    ]) {
      expect(rls.has(table), `${table} has no RLS`).toBe(true);
    }
  });

  it("no migration grants the anon or authenticated role access to a table", () => {
    // The other direction. RLS filters a grant; removing the grant means there is
    // nothing to filter. A future `grant select on ... to anon` would re-open
    // everything RLS is holding shut, and it would look routine in review.
    const offenders: string[] = [];
    for (const { file, text } of sql()) {
      const re = /grant\s+[^;]*?\s+to\s+(anon|authenticated)\b/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code(text)))) {
        offenders.push(`${file}: grants to ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no migration disables row level security", () => {
    const offenders: string[] = [];
    for (const { file, text } of sql()) {
      if (/disable\s+row\s+level\s+security/i.test(code(text))) {
        offenders.push(file);
      }
    }
    expect(offenders, "a migration turns RLS off").toEqual([]);
  });

  it("no policy grants a non-service role read access", () => {
    // Zero policies under RLS is a total deny. A policy is therefore an explicit
    // statement that some non-service role MAY read these rows — which, for this
    // database, nothing should. Any policy needs review, so surfacing them is the
    // point rather than assuming they are benign.
    const policies: string[] = [];
    for (const { file, text } of sql()) {
      const re = /create\s+policy\s+"?([\w\s-]+)"?[^;]*?on\s+(?:public\.)?"?(\w+)"?/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code(text)))) policies.push(`${file}: ${m[1].trim()} on ${m[2]}`);
    }
    expect(
      policies,
      "RLS policies exist. Each is a statement that a non-service role may read " +
        "customer rows — confirm that is intended, then allowlist it here."
    ).toEqual([]);
  });
});
