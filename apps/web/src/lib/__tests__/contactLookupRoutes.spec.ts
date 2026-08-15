// /api/contacts/resolve and /api/contacts/recent — the two read endpoints the
// send sheet leans on.
//
// What only the routes can get wrong: auth, parameter validation, and the
// status code chosen for each outcome. The last one is the important one — a
// resolver outage MUST be a 503, because a 404 tells the user their friend's
// name does not exist and sends them back to pasting an address.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const resolveName = vi.fn();
vi.mock("@/lib/nameResolution", () => ({ resolveName }));

const listPaymentsForUser = vi.fn();
vi.mock("@/lib/paymentsDb", () => ({ listPaymentsForUser }));

const { GET: resolveGET } = await import("@/app/api/contacts/resolve/route");
const { GET: recentGET } = await import("@/app/api/contacts/recent/route");
const { signSession } = await import("@/lib/session");
const { findOrCreateUserByIdentity } = await import("@/lib/store");
const { createContact } = await import("@/lib/contacts");

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

async function actor() {
  const { account } = findOrCreateUserByIdentity({
    email: `clookup-${randomUUID()}@furlpay.test`,
    name: "Lookup User",
  });
  account.contacts = [];
  const token = await signSession({
    sub: account.user.id,
    safe: "0x0",
    roles: ["user"],
    jti: randomUUID(),
  });
  return { account, token };
}

function req(path: string, token?: string) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.15.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`https://furlpay.com/api/contacts${path}`, { headers });
}

beforeEach(() => {
  resolveName.mockReset();
  listPaymentsForUser.mockReset();
});

describe("GET /api/contacts/resolve", () => {
  it("401s an unauthenticated request", async () => {
    expect((await resolveGET(req("/resolve?name=vitalik.eth"))).status).toBe(401);
  });

  it("400s a missing name", async () => {
    const { token } = await actor();
    expect((await resolveGET(req("/resolve", token))).status).toBe(400);
  });

  it("400s an unsupported chain", async () => {
    const { token } = await actor();
    const res = await resolveGET(req("/resolve?name=vitalik.eth&chain=optimism", token));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_chain");
  });

  it("returns the resolved address", async () => {
    const { token } = await actor();
    resolveName.mockResolvedValue({
      status: "resolved",
      result: { query: "vitalik.eth", kind: "ens", address: EVM, family: "evm", display: "vitalik.eth" },
    });
    const res = await resolveGET(req("/resolve?name=vitalik.eth&chain=base", token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ resolved: true, address: EVM, kind: "ens", payableOnChain: true });
  });

  it("flags an EVM result as not payable when the user is sending on Solana", async () => {
    const { token } = await actor();
    resolveName.mockResolvedValue({
      status: "resolved",
      result: { query: "vitalik.eth", kind: "ens", address: EVM, family: "evm", display: "vitalik.eth" },
    });
    const body = await (await resolveGET(req("/resolve?name=vitalik.eth&chain=solana", token))).json();
    expect(body.payableOnChain).toBe(false);
  });

  it("names the contact when the resolved address is already saved", async () => {
    const { account, token } = await actor();
    const created = createContact(account, {
      name: "Alice",
      avatarColor: "#3B82F6",
      addresses: [{ address: EVM, chain: "base" }],
    });
    if (!created.ok) throw new Error("setup failed");

    resolveName.mockResolvedValue({
      status: "resolved",
      result: { query: EVM, kind: "address", address: EVM, family: "evm", display: EVM },
    });
    const body = await (await resolveGET(req(`/resolve?name=${EVM}&chain=base`, token))).json();
    expect(body.contact).toEqual({ id: created.value.id, name: "Alice", avatarColor: "#3B82F6" });
  });

  it("404s a name that resolves to nothing", async () => {
    const { token } = await actor();
    resolveName.mockResolvedValue({ status: "unresolved", kind: "ens" });
    expect((await resolveGET(req("/resolve?name=nobody.eth", token))).status).toBe(404);
  });

  it("503s — NOT 404s — when the resolver itself is unavailable", async () => {
    const { token } = await actor();
    resolveName.mockResolvedValue({ status: "unavailable", kind: "ens", reason: "RPC down" });
    const res = await resolveGET(req("/resolve?name=vitalik.eth", token));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("resolver_unavailable");
    // The upstream error text is not echoed to the client.
    expect(JSON.stringify(body)).not.toContain("RPC down");
  });
});

describe("GET /api/contacts/recent", () => {
  it("401s an unauthenticated request", async () => {
    expect((await recentGET(req("/recent"))).status).toBe(401);
  });

  it("reports durable:false rather than an empty history when the table is absent", async () => {
    const { token } = await actor();
    listPaymentsForUser.mockResolvedValue(null);
    const body = await (await recentGET(req("/recent", token))).json();
    expect(body).toEqual({ recents: [], durable: false });
  });

  it("summarizes real payments for the caller only", async () => {
    const { account, token } = await actor();
    listPaymentsForUser.mockResolvedValue([
      {
        id: "p1",
        created_by_user_id: account.user.id,
        status: "settled",
        amount_usdc: "10",
        source_chain: "arbitrum",
        recipient: EVM,
        expires_at: "2026-09-01T00:00:00.000Z",
        created_at: "2026-08-08T00:00:00.000Z",
      },
    ]);
    const body = await (await recentGET(req("/recent", token))).json();
    expect(listPaymentsForUser).toHaveBeenCalledWith(account.user.id, expect.any(Number));
    expect(body.durable).toBe(true);
    expect(body.recents).toHaveLength(1);
    expect(body.recents[0]).toMatchObject({ address: EVM, chain: "arbitrum", count: 1 });
  });

  it("filters to the requested chain family", async () => {
    const { account, token } = await actor();
    const base = {
      created_by_user_id: account.user.id,
      status: "settled" as const,
      amount_usdc: "10",
      expires_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-08-08T00:00:00.000Z",
    };
    listPaymentsForUser.mockResolvedValue([
      { ...base, id: "p1", source_chain: "arbitrum", recipient: EVM },
      { ...base, id: "p2", source_chain: "solana", recipient: SOL },
    ]);
    const body = await (await recentGET(req("/recent?chain=solana", token))).json();
    expect(body.recents.map((r: { address: string }) => r.address)).toEqual([SOL]);
  });

  it("400s an unsupported chain", async () => {
    const { token } = await actor();
    expect((await recentGET(req("/recent?chain=optimism", token))).status).toBe(400);
  });
});
