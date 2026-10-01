import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

// ---------------------------------------------------------------------------
// T-E2 — `safeAddress` can never become a live blockchain recipient.
//
// user.safeAddress is "0x" + sha256("furlpay:safe:" + key)[:40]: no private key
// exists for it and no contract is deployed there. Three live paths still named
// it as the destination of real value:
//   - POST /api/earn/deposit (INTEGRATION_MODE=live): vault shares minted to it
//   - POST /api/earn/withdraw (live): withdrawn USDC sent to it
//   - GET  /api/contacts/resolve "name.furlpay": the payable address handed to
//     anyone paying a FurlPay user by handle
// Each now uses the VERIFIED linked wallet or refuses. Pinned behaviourally and
// by a source tripwire.
// ---------------------------------------------------------------------------

const LINKED = "0x1234567890abcdef1234567890abcdef12345678";
const SAFE_PLACEHOLDER = "0x" + "5a".repeat(20);

const H = vi.hoisted(() => ({ linked: null as null | Record<string, unknown>, bundles: [] as { receiver: string }[] }));

vi.mock("@/lib/linkedWalletStore", () => ({
  loadLinkedWallet: vi.fn(async () => H.linked),
  findLinkedWalletOwner: vi.fn(async () => null),
}));
vi.mock("@/lib/authz", () => ({
  requireUser: vi.fn(async () => ({
    ok: true,
    claims: { sub: "u1" },
    account: { user: { id: "u1", safeAddress: SAFE_PLACEHOLDER }, tokenBalances: [] },
  })),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));
vi.mock("@/lib/biometrics/enforceStepUp", () => ({ enforceActionStepUp: vi.fn(async () => null) }));
vi.mock("@/lib/idempotency", () => ({ withIdempotency: (_k: unknown, _s: unknown, fn: () => unknown) => fn() }));
vi.mock("@/lib/services/morpho", () => ({
  earnIsLive: () => true,
  selectVault: vi.fn(async () => ({ address: "0x" + "77".repeat(20), name: "Vault", netApy: 0.05, chainId: 42161 })),
  buildDepositBundle: vi.fn((_v: string, _a: number, receiver: string) => {
    H.bundles.push({ receiver });
    return { chainId: 42161, calls: [] };
  }),
  buildWithdrawBundle: vi.fn((_v: string, _a: number, receiver: string) => {
    H.bundles.push({ receiver });
    return { chainId: 42161, calls: [] };
  }),
}));

import { POST as earnDeposit } from "@/app/api/earn/deposit/route";
import { POST as earnWithdraw } from "@/app/api/earn/withdraw/route";

const req = (path: string) =>
  new Request(`http://localhost/api/earn/${path}`, {
    method: "POST",
    body: JSON.stringify({ amountUsd: 100 }),
    headers: { "content-type": "application/json" },
  }) as never;

const ACTIVE = { address: LINKED, chainFamily: "evm", verificationMethod: "eip191", status: "active", verifiedAt: "2026-09-30T00:00:00Z" };

beforeEach(() => {
  H.linked = null;
  H.bundles.length = 0;
});

describe.each([
  ["earn deposit", () => earnDeposit(req("deposit"))],
  ["earn withdraw", () => earnWithdraw(req("withdraw"))],
])("%s in LIVE mode", (_name, call) => {
  it("without a verified wallet: 409 wallet_required and NO transaction bundle", async () => {
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "wallet_required" });
    expect(H.bundles).toHaveLength(0);
  });

  it("with a verified wallet: the receiver is that wallet, never the placeholder", async () => {
    H.linked = ACTIVE;
    const res = await call();
    expect(res.status).toBe(200);
    expect(H.bundles).toEqual([{ receiver: LINKED }]);
  });
});

describe("source tripwire", () => {
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
  const code = (f: string) =>
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  // Contexts in which an address becomes a place value is SENT.
  const RECIPIENT_USES = [
    /Bundle\([^)]*safeAddress/, // buildDepositBundle / buildWithdrawBundle(…, safeAddress)
    /\breceiver\s*[:=]\s*[\w.]*safeAddress/,
    /\brecipient\s*[:=]\s*[\w.]*safeAddress/,
    /\bdestination\s*[:=]\s*[\w.]*safeAddress/,
    /\bto\s*:\s*[\w.]*safeAddress/,
    /\baddress\s*:\s*account\.user\.safeAddress/,
    /\bpayTo\s*[:=]\s*[\w.]*safeAddress/,
  ];

  it("no executable code names safeAddress as a receiver, recipient or payable address", () => {
    const hits = walk(SRC).flatMap((f) => {
      const c = code(f);
      return RECIPIENT_USES.filter((re) => re.test(c)).map((re) => `${relative(SRC, f).split(sep).join("/")}  ${re}`);
    });
    expect(hits).toEqual([]);
  });
});
