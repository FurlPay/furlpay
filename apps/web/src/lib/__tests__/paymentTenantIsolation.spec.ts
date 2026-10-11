import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * Two accounts, each with its own payments, exercised through the real
 * payment service and the real route handlers. The question every test asks
 * is the same: can one principal obtain a record that belongs to the other?
 *
 * This is the regression suite for the cross-account disclosure fixed in
 * 653c69be, where listPayments() had no owner and two routes returned every
 * account's records.
 */

type Principal = { kind: "session"; userId: string } | { kind: "key"; userId: string; scopes: string[] } | { kind: "none" };
let principal: Principal = { kind: "none" };

vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: async () => null }));
vi.mock("@/lib/authz", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireUser: async () =>
      principal.kind === "session"
        ? { ok: true, account: { user: { id: principal.userId } }, claims: {} }
        : { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
  };
});
vi.mock("@/lib/apiKeyAuth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireApiKey: async (_req: unknown, opts: { scope: string }) => {
      if (principal.kind !== "key") return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
      if (!principal.scopes.includes(opts.scope)) return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
      return { ok: true, record: { keyId: "k", userId: principal.userId, environment: "test", scopes: principal.scopes } };
    },
  };
});

const { createPayment, listPayments, getPayment } = await import("@/lib/services/payments");
const history = await import("@/app/api/payments/history/route");
const v1 = await import("@/app/api/v1/payments/route");

const ALICE = "user-alice";
const BOB = "user-bob";
const RECIPIENT_A = "0x1111111111111111111111111111111111111111";
const RECIPIENT_B = "0x2222222222222222222222222222222222222222";
const ids: Record<string, string[]> = { [ALICE]: [], [BOB]: [] };

beforeAll(async () => {
  for (const [userId, recipient, note] of [
    [ALICE, RECIPIENT_A, "alice-private-order"],
    [BOB, RECIPIENT_B, "bob-private-order"],
  ] as const) {
    for (let i = 0; i < 3; i++) {
      const { record } = await createPayment({ amount: 10 + i, sourceChain: "arbitrum", recipient, userId, metadata: { note: `${note}-${i}` } });
      ids[userId].push(record.id);
    }
  }
});

const req = (path: string) => new NextRequest(`https://furlpay.test${path}`);
type Listed = { payments: { id: string; createdByUserId: string; metadata?: Record<string, string> }[]; count: number };

describe("the service: a list always has an owner", () => {
  it("returns only the named account's payments", () => {
    expect(listPayments(ALICE).map((p) => p.id).sort()).toEqual([...ids[ALICE]].sort());
    expect(listPayments(BOB).map((p) => p.id).sort()).toEqual([...ids[BOB]].sort());
  });

  it("returns nothing for an empty, unknown or look-alike owner", () => {
    for (const owner of ["", "user-", "user-alice ", "USER-ALICE", "*", "%", "user-alice' OR '1'='1", "undefined", "null"]) {
      expect(listPayments(owner), JSON.stringify(owner)).toEqual([]);
    }
  });

  it("cannot be widened by the limit", () => {
    for (const limit of [200, 10_000, Number.MAX_SAFE_INTEGER, -1, 0]) {
      const got = listPayments(ALICE, limit);
      expect(got.every((p) => p.createdByUserId === ALICE || p.payerUserId === ALICE)).toBe(true);
    }
  });
});

describe("GET /api/payments/history (session)", () => {
  it("refuses a caller with no session", async () => {
    principal = { kind: "none" };
    const res = await history.GET(req("/api/payments/history"));
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toMatch(/pay_/);
  });

  it("gives each account only its own records", async () => {
    for (const [me, other] of [[ALICE, BOB], [BOB, ALICE]] as const) {
      principal = { kind: "session", userId: me };
      const res = await history.GET(req("/api/payments/history"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Listed;
      expect(body.payments.map((p) => p.id).sort()).toEqual([...ids[me]].sort());
      expect(body.count).toBe(ids[me].length);
      // Not one id, and not one byte of the other account's metadata.
      const raw = JSON.stringify(body);
      for (const foreign of ids[other]) expect(raw).not.toContain(foreign);
      expect(raw).not.toContain(other === BOB ? "bob-private-order" : "alice-private-order");
    }
  });

  it("ignores every query parameter that names another account", async () => {
    principal = { kind: "session", userId: ALICE };
    for (const q of [`?userId=${BOB}`, `?owner=${BOB}`, `?createdByUserId=${BOB}`, `?ownerUserId=${BOB}`, `?user=${BOB}&limit=200`, "?limit=99999", "?limit=-5", "?limit=abc", "?cursor=0&offset=3"]) {
      const body = (await (await history.GET(req(`/api/payments/history${q}`))).json()) as Listed;
      expect(body.payments.every((p) => ids[ALICE].includes(p.id)), q).toBe(true);
    }
  });

  it("is not cacheable by a shared cache", async () => {
    principal = { kind: "session", userId: ALICE };
    expect((await history.GET(req("/api/payments/history"))).headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/v1/payments (API key)", () => {
  it("refuses a request with no key", async () => {
    principal = { kind: "none" };
    expect((await v1.GET(req("/api/v1/payments"))).status).toBe(401);
  });

  it("refuses a key without payments:read", async () => {
    principal = { kind: "key", userId: ALICE, scopes: ["payments:create"] };
    const res = await v1.GET(req("/api/v1/payments"));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toMatch(/pay_/);
  });

  it("gives a key only its owner's records", async () => {
    for (const [me, other] of [[ALICE, BOB], [BOB, ALICE]] as const) {
      principal = { kind: "key", userId: me, scopes: ["payments:read"] };
      const body = (await (await v1.GET(req("/api/v1/payments"))).json()) as Listed;
      expect(body.payments.map((p) => p.id).sort()).toEqual([...ids[me]].sort());
      for (const foreign of ids[other]) expect(JSON.stringify(body)).not.toContain(foreign);
    }
  });

  it("ignores query parameters that name another account", async () => {
    principal = { kind: "key", userId: ALICE, scopes: ["payments:read"] };
    for (const q of [`?userId=${BOB}`, `?owner=${BOB}`, "?limit=100000"]) {
      const body = (await (await v1.GET(req(`/api/v1/payments${q}`))).json()) as Listed;
      expect(body.payments.every((p) => ids[ALICE].includes(p.id)), q).toBe(true);
    }
  });
});

describe("payment ids are not enumerable", () => {
  // GET /api/payments/:id returns a reduced view to whoever holds the id (the
  // payment link holder is not the payer). That is only safe if an id cannot
  // be guessed from another one.
  it("carries 96 bits of randomness and shares nothing with its neighbours", () => {
    const all = [...ids[ALICE], ...ids[BOB]];
    for (const id of all) expect(id).toMatch(/^pay_[0-9a-f]{24}$/);
    expect(new Set(all).size).toBe(all.length);
    // Sequential or timestamp-derived ids share a long common prefix.
    const hex = all.map((id) => id.slice(4));
    for (let i = 1; i < hex.length; i++) {
      let common = 0;
      while (common < 24 && hex[i][common] === hex[i - 1][common]) common++;
      expect(common, `${hex[i - 1]} vs ${hex[i]}`).toBeLessThan(8);
    }
  });

  it("does not resolve a near-miss id", () => {
    const real = ids[BOB][0];
    const last = real.slice(-1) === "0" ? "1" : "0";
    expect(getPayment(real.slice(0, -1) + last)).toBeUndefined();
    expect(getPayment("pay_" + "0".repeat(24))).toBeUndefined();
  });
});
