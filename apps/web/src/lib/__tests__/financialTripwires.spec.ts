import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

// ---------------------------------------------------------------------------
// Source tripwires for the financial-safety rules (EXHAUSTIVE_SECURITY_REMEDIATION.md).
// Each rule is a precise pattern with an explicit, reasoned allowlist — a new
// match fails CI and must either be fixed or argued into the allowlist.
// Existing, separate tripwires: adminFallback.spec (fallback admin identity),
// safeAddressNeverRecipient.spec (keyless recipients), extension
// receiveAddress.test (extension addresses).
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(SRC, f).split(sep).join("/");
const code = (f: string) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const FILES = walk(SRC).map((f) => ({ path: rel(f), src: code(f) }));
const hits = (re: RegExp, allow: Set<string> = new Set()) =>
  FILES.filter((f) => re.test(f.src) && !allow.has(f.path)).map((f) => f.path);

describe("financial effect keys are deterministic", () => {
  it("no effectKey is built from randomness or the clock", () => {
    const bad = FILES.flatMap((f) =>
      [...f.src.matchAll(/effectKey\s*:\s*([^\n,}]+)/g)]
        .filter((m) => /randomUUID|randomBytes|Math\.random|Date\.now|new Date\(/.test(m[1]))
        .map((m) => `${f.path}: ${m[1].trim()}`)
    );
    expect(bad).toEqual([]);
  });

  it("every applyFinancialEffect/recordMovement-with-key call passes an effectKey", () => {
    const missing = FILES.filter((f) => /applyFinancialEffect\(\{/.test(f.src))
      .flatMap((f) => [...f.src.matchAll(/applyFinancialEffect\(\{([\s\S]*?)\}\)/g)].filter((m) => !/effectKey/.test(m[1])).map(() => f.path))
      .filter((p) => p !== "lib/ledger.ts");
    expect(missing).toEqual([]);
  });
});

describe("token amounts are never floats at the source", () => {
  it("no Number()/parseFloat() over raw base-unit values", () => {
    // Chain-value identifiers only (a UI `Number(e.target.value)` is not a token amount).
    expect(hits(/\b(Number|parseFloat|parseInt)\(\s*(tx|log|transfer|receipt|event|payload|p)\??\.(value|rawValue)\b|\b(Number|parseFloat|parseInt)\(\s*[\w.?]*\b(rawValue|baseUnits|amountRaw|raw_amount)\b/)).toEqual([]);
  });

  it("no `x / 10 ** decimals` conversion of a chain amount", () => {
    // DISPLAY/QUOTE ONLY, never an internal balance or ledger amount:
    //   chains/evmAdapter.ts, onchain/balances.ts — render on-chain balances
    //   services/swap.ts — LI.FI quote amounts the user signs non-custodially
    // Precision above 2^53 base units is a known display limitation (P4).
    const DISPLAY = new Set(["lib/chains/evmAdapter.ts", "lib/onchain/balances.ts", "lib/services/swap.ts"]);
    expect(hits(/\/\s*10\s*\*\*\s*[\w.()?]*decimals/i, DISPLAY)).toEqual([]);
  });
});

describe("in-memory money mutation is confined to gated simulations", () => {
  // Each allowlisted file is a development/mock simulation that production
  // refuses BEFORE the mutation (the gate string must be present). Real money
  // moves only through apply_financial_effect (migration 0025); since 0025 the
  // snapshot flush cannot write a balance either.
  const GATED: Record<string, RegExp> = {
    "app/api/earn/deposit/route.ts": /NODE_ENV === "production" && !live/,
    "app/api/earn/withdraw/route.ts": /NODE_ENV === "production" && !live/,
    "app/api/intents/route.ts": /NODE_ENV === "production"/,
    "app/api/swaps/route.ts": /NODE_ENV === "production"/,
    "app/api/wallets/transfer/route.ts": /NODE_ENV === "production"/,
    "lib/services/p2pSettlement.ts": /capabilityUnavailable\("P2P_LIVE"/,
    // The sanctioned dev-only mutator and the DB-refresh splice.
    "lib/store.ts": /if \(durable\) throw new Error\("in-memory balance deltas are not allowed with a durable backend"\)/,
  };
  const MUTATION = /tokenBalances\.push\(|fiatBalances\.push\(|\b(bal|entry|src|dst|b|balance)\.amount\s*(=|\+=|-=)(?!=)/;

  it("no ungated file mutates a balance in memory", () => {
    expect(hits(MUTATION, new Set(Object.keys(GATED)))).toEqual([]);
  });

  it("every allowlisted file still carries its production gate", () => {
    const lost = Object.entries(GATED)
      .filter(([p, gate]) => {
        const f = FILES.find((x) => x.path === p);
        return f && MUTATION.test(f.src) && !gate.test(f.src);
      })
      .map(([p]) => p);
    expect(lost).toEqual([]);
  });
});

describe("no silent failure on the money path", () => {
  const MONEY = [
    "lib/ledger.ts",
    "lib/services/account.ts",
    "lib/services/membership.ts",
    "lib/withDurableWebhook.ts",
    "lib/webhookEvents.ts",
    "lib/payments/stripeReversals.ts",
    "app/api/webhooks/stripe/route.ts",
    "app/api/account/fund/route.ts",
    "app/api/topup/apple-pay/route.ts",
    "app/api/membership/cashback/claim/route.ts",
  ];
  it("no empty catch / `.catch(() => {})` in money modules", () => {
    const bad = MONEY.filter((p) => {
      const f = FILES.find((x) => x.path === p);
      return f && /catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\(\)\s*=>\s*\{\s*\}\)|\.catch\(\(\)\s*=>\s*(undefined|null|true|false)\)/.test(f.src);
    });
    expect(bad).toEqual([]);
  });
});

describe("authorisation identity comes from the session", () => {
  // The only routes that read a user id from the request, each for a stated reason.
  const ALLOWED = new Set([
    "app/api/p2p/merchant/route.ts", // ?userId= reads ANOTHER user's public badge only
    "app/api/account/fund/route.ts", // destinationUserId: deposit-by-account-number; money arrives, never leaves
  ]);
  it("no route takes userId/accountId/ownerId from the body or query", () => {
    const re = /(body|data|parsed\.data|input|payload)\??\.(userId|accountId|ownerId|customerId|destinationUserId)\b|searchParams\.get\(\s*["'](userId|accountId|ownerId|customerId)["']\s*\)/;
    const bad = FILES.filter((f) => f.path.startsWith("app/api/") && re.test(f.src) && !ALLOWED.has(f.path)).map((f) => f.path);
    expect(bad).toEqual([]);
  });
});
