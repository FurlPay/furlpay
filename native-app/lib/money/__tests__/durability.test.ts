import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Durability and recovery invariants.
//
// expo-sqlite has no in-process driver under jest-expo, so the store's SQL is
// pinned at source level the same way outbox.test.ts and sendSafety.test.ts
// pin theirs. The ORDERING rules — which are what actually make a restart
// recoverable — are asserted against the real call sites.
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, "..", "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (...p: string[]) => strip(fs.readFileSync(path.join(ROOT, ...p), "utf8"));

const store = read("lib", "money", "transactionStore.ts");
const reconcile = read("lib", "money", "reconcile.ts");
const db = read("lib", "db.ts");
const send = read("lib", "send", "useSend.ts");
const swap = read("lib", "swap", "useSwap.ts");
const layout = read("app", "_layout.tsx");

describe("the schema is durable and holds no secrets", () => {
  const schema = db.match(/CREATE TABLE IF NOT EXISTS money_transactions[\s\S]*?\);/)?.[0] ?? "";

  it("exists as a migration, not an ad-hoc CREATE", () => {
    expect(schema).not.toBe("");
    // Appended to MIGRATIONS, so an existing install is moved forward rather
    // than silently skipped by CREATE TABLE IF NOT EXISTS.
    expect(db.indexOf("money_transactions")).toBeGreaterThan(db.indexOf("device_prefs"));
  });

  it("persists the identity a restart needs", () => {
    for (const col of [
      "id TEXT PRIMARY KEY",
      "idempotency_key TEXT NOT NULL",
      "operation TEXT NOT NULL",
      "state TEXT NOT NULL",
      "amount_usd REAL NOT NULL",
      "created_at INTEGER NOT NULL",
      "updated_at INTEGER NOT NULL",
    ]) {
      expect(schema).toContain(col);
    }
  });

  it("stores NO secret material", () => {
    // The database is not encrypted at rest; what is here is what a rooted
    // device may read.
    for (const forbidden of [
      "signature",
      "private_key",
      "mnemonic",
      "token TEXT",
      "cvv",
      "pan",
      "card_number",
      "access_token",
      "session",
      "password",
    ]) {
      expect(schema.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("enforces one row per idempotency key", () => {
    // Two rows sharing a key would mean two records of one payment, and the
    // recovery loop would reconcile it twice.
    expect(db).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_money_tx_idem/);
  });

  it("indexes the columns recovery actually reads", () => {
    expect(db).toMatch(/CREATE INDEX IF NOT EXISTS idx_money_tx_state/);
  });

  it("IS wiped by sign-out, like every other account-scoped table", () => {
    // The durability requirement is surviving PROCESS DEATH, not sign-out.
    //
    // This table holds amounts and destinations — the same class of data as the
    // swaps journal, which is wiped for exactly this reason. Leaving it would
    // show the next account on this device the previous user's payments.
    //
    // The tradeoff is explicit: signing out while a payment is unresolved
    // abandons the LOCAL record of it. The money is unaffected — the server
    // still holds the idempotency record and the transaction stays in
    // server-side history — but this device can no longer reconcile it.
    const wipe = db.match(/export function clearAllCaches[\s\S]*?\n}/)?.[0] ?? "";
    expect(wipe).not.toBe("");
    expect(wipe).toContain("money_transactions");
  });
});

describe("the store never writes an illegal state", () => {
  it("routes every write through transition()", () => {
    expect(store).toMatch(/const state = transition\(current\.state, next\)/);
  });

  it("treats an unreadable persisted state as needing reconciliation, not as complete", () => {
    // Guessing COMPLETED from a corrupt row is the one failure that silently
    // tells a user their money arrived.
    expect(store).toMatch(/parseTxState\(r\.state\) \?\? "PROCESSING"/);
  });

  it("returns the existing row for a repeated idempotency key", () => {
    // A re-attempt of the same intent is the SAME transaction.
    const create = store.slice(store.indexOf("export function createTransaction"));
    expect(create).toMatch(/getByIdempotencyKey\(input\.idempotencyKey\)/);
    expect(create).toMatch(/if \(existing\) return existing/);
  });

  it("takes the idempotency key as an argument rather than minting its own", () => {
    // Minting here would break the payload-fingerprint / quoteId derivation
    // that makes a retry reuse the original key.
    expect(store).toMatch(/idempotencyKey: string/);
    const create = store.slice(
      store.indexOf("export function createTransaction"),
      store.indexOf("export function getTransaction")
    );
    expect(create).not.toMatch(/idempotencyKey: `?crypto\.randomUUID/);
  });

  it("never prunes an unresolved transaction, however old", () => {
    const prune = store.slice(store.indexOf("export function pruneSettled"));
    expect(prune).toMatch(/'COMPLETED', 'FAILED', 'REVERSED', 'CANCELLED'/);
    expect(prune).not.toMatch(/SUBMITTED|PROCESSING/);
  });
});

describe("persistence happens BEFORE submission", () => {
  it.each([
    ["send", send, '"/wallets/transfer"'],
    ["swap", swap, "execute: true"],
  ])("%s writes the row before the request leaves", (_name, src, requestMarker) => {
    const execFn = src.slice(src.indexOf("const execute = useCallback"));
    const createAt = execFn.indexOf("createTransaction(");
    const requestAt = execFn.indexOf(requestMarker);
    expect(createAt).toBeGreaterThan(-1);
    expect(requestAt).toBeGreaterThan(createAt);
  });

  it.each([
    ["send", send],
    ["swap", swap],
  ])("%s persists CREATED before it even evaluates risk", (_name, src) => {
    // So a death during the biometric prompt still leaves evidence.
    const execFn = src.slice(src.indexOf("const execute = useCallback"));
    const createAt = execFn.indexOf("createTransaction(");
    const authAt = execFn.indexOf("authorizeMoneyMove(");
    expect(createAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(createAt);
  });

  it.each([
    ["send", send],
    ["swap", swap],
  ])("%s persists SUBMITTED before awaiting the response", (_name, src) => {
    const execFn = src.slice(src.indexOf("const execute = useCallback"));
    const submittedAt = execFn.indexOf('updateTransactionState(tx.id, "SUBMITTED")');
    const awaitAt = execFn.indexOf("await api<");
    expect(submittedAt).toBeGreaterThan(-1);
    expect(awaitAt).toBeGreaterThan(submittedAt);
  });

  it.each([
    ["send", send],
    ["swap", swap],
  ])("%s sends the SAME key it persisted", (_name, src) => {
    expect(src).toMatch(/idempotencyKey: key/);
    expect(src).toMatch(/"Idempotency-Key": key/);
  });
});

describe("a timeout is an unknown outcome, never a failure", () => {
  it.each([
    ["send", send],
    ["swap", swap],
  ])("%s marks it unknown and tells the user not to retry", (_name, src) => {
    const execFn = src.slice(src.indexOf("const execute = useCallback"));
    expect(execFn).toMatch(/e instanceof TimeoutError/);
    expect(execFn).toMatch(/markUnknownOutcome\(tx\.id/);
    // The copy must not say "failed", and must actively discourage a re-send.
    const branch = execFn.slice(execFn.indexOf("e instanceof TimeoutError"));
    const copy = branch.slice(0, 700);
    expect(copy).toMatch(/don't (send|submit) it again/i);
    expect(copy.toLowerCase()).not.toMatch(/payment failed|swap failed/);
  });

  it("marks unknown only once the request has actually left", () => {
    // Before submission nothing is in doubt — it was simply abandoned.
    const fn = store.slice(store.indexOf("export function markUnknownOutcome"));
    expect(fn).toMatch(/requiresIdempotentRetry\(current\.state\)/);
  });

  it("decides FAILED from the PERSISTED state, not a stale snapshot", () => {
    for (const src of [send, swap]) {
      expect(src).toMatch(/getTransaction\(tx\.id\)/);
      expect(src).toMatch(/persisted && persisted\.state !== "CREATED" \? "FAILED" : "CANCELLED"/);
    }
  });
});

describe("recovery asks; it never re-submits", () => {
  it("makes only GET requests", () => {
    // The whole safety property of reconciliation.
    expect(reconcile).not.toMatch(/method:\s*"POST"/);
    expect(reconcile).not.toMatch(/method:\s*"PUT"/);
    expect(reconcile).toContain("/transactions/status?");
  });

  it("excludes CREATED — nothing left the device, so there is nothing to ask", () => {
    const fn = store.slice(store.indexOf("export function getRecoverableTransactions"));
    expect(fn).toMatch(/'SUBMITTED', 'PROCESSING'/);
    expect(fn).not.toMatch(/'CREATED'/);
  });

  it("leaves a transaction unresolved when the server cannot be reached", () => {
    // Not being able to ask is not evidence that nothing happened.
    expect(reconcile).toMatch(/NetworkError \|\| e instanceof TimeoutError/);
    expect(reconcile).toMatch(/reason: "unreachable"/);
  });

  it("never maps an unknown record onto FAILED", () => {
    // The server having no record is not proof of failure — the request may
    // never have arrived, or the 24h window may have passed.
    const unknownBranch = reconcile.slice(reconcile.indexOf('res.state === "PROCESSING"'));
    expect(unknownBranch).not.toMatch(/markReconciled\([^)]*"FAILED"/);
  });

  it("is re-entrant safe, so two resume handlers cannot double-run it", () => {
    expect(reconcile).toMatch(/let running = false/);
    expect(reconcile).toMatch(/if \(running\) return result/);
  });

  it("runs on cold start AND on foreground resume", () => {
    expect(layout).toContain("recoverPendingTransactions");
    const resumeBlock = layout.slice(layout.indexOf('next === "active"'));
    expect(resumeBlock.slice(0, 300)).toContain("recoverPendingTransactions");
  });

  it("declares honestly which operations cannot be reconciled", () => {
    // /api/swaps, /api/bills and /api/offramp do not write an idempotency
    // record, so there is nothing to resolve a key against. Claiming a scope
    // the server never writes would be a promise it cannot keep.
    expect(reconcile).toMatch(/swap: null/);
    expect(reconcile).toMatch(/withdraw: null/);
    expect(reconcile).toMatch(/bill: null/);
    expect(reconcile).toMatch(/send: "wallets\.transfer"/);
  });
});

describe("demoSignature cannot authorize real money in production", () => {
  const route = fs.readFileSync(
    path.join(ROOT, "..", "apps", "web", "src", "app", "api", "wallets", "transfer", "route.ts"),
    "utf8"
  );

  it("the route refuses outright when NODE_ENV is production", () => {
    const post = route.slice(route.indexOf("export async function POST"));
    const gateAt = post.indexOf('process.env.NODE_ENV === "production"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(post.slice(gateAt, gateAt + 400)).toContain("service_unavailable");
    expect(post.slice(gateAt, gateAt + 400)).toContain("503");
  });

  it("the gate is the FIRST thing POST does — before auth, before any money", () => {
    const post = route.slice(route.indexOf("export async function POST"));
    const gateAt = post.indexOf('process.env.NODE_ENV === "production"');
    const authAt = post.indexOf("requireUser(");
    const idemAt = post.indexOf("withIdempotency(");
    expect(gateAt).toBeLessThan(authAt);
    expect(gateAt).toBeLessThan(idemAt);
  });

  it("demoSignature is used by no path other than this gated demo route", () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name)) {
          const src = strip(fs.readFileSync(full, "utf8"));
          // The export itself lives in lib/api.ts.
          if (src.includes("demoSignature(") && !full.endsWith(path.join("lib", "api.ts"))) {
            callers.push(path.relative(ROOT, full));
          }
        }
      }
    };
    walk(path.join(ROOT, "lib"));
    walk(path.join(ROOT, "app"));
    // Exactly one caller: the Send hook, whose only endpoint is the
    // production-gated demo transfer route asserted above.
    expect(callers).toEqual([path.join("lib", "send", "useSend.ts")]);
  });
});
