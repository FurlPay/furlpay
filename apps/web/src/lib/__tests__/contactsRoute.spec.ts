// /api/contacts — drives the REAL routes.
//
// contacts.spec.ts covers the domain rules; this covers what only the routes
// have: auth, Zod validation, the chain filter, whitelisted patching, and that
// one account can never see or touch another's contacts.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET as listGET, POST as createPOST } from "@/app/api/contacts/route";
import {
  DELETE as contactDELETE,
  GET as contactGET,
  PATCH as contactPATCH,
} from "@/app/api/contacts/[id]/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity } from "@/lib/store";

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

async function actor() {
  const { account } = findOrCreateUserByIdentity({
    email: `croute-${randomUUID()}@furlpay.test`,
    name: "Contact Route User",
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

function req(token: string | undefined, body?: unknown, query = "", method = "GET") {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.13.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`https://furlpay.com/api/contacts${query}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/contacts", () => {
  it("401s an unauthenticated request", async () => {
    const res = await createPOST(req(undefined, { name: "A", avatarColor: "#3B82F6" }, "", "POST"));
    expect(res.status).toBe(401);
  });

  it("creates a contact", async () => {
    const a = await actor();
    const res = await createPOST(
      req(a.token, { name: "Alice", avatarColor: "#3B82F6", addresses: [{ address: EVM, chain: "base" }] }, "", "POST")
    );
    expect(res.status).toBe(201);
    const { contact } = await res.json();
    expect(contact.name).toBe("Alice");
    expect(contact.addresses[0].isDefault).toBe(true);
  });

  it("rejects a colour outside the palette (it is interpolated into style)", async () => {
    const a = await actor();
    const res = await createPOST(
      req(a.token, { name: "B", avatarColor: "javascript:alert(1)" }, "", "POST")
    );
    expect(res.status).toBe(400);
  });

  it("400s an address that is not payable on its declared chain", async () => {
    const a = await actor();
    const res = await createPOST(
      req(a.token, { name: "C", avatarColor: "#3B82F6", addresses: [{ address: SOL, chain: "base" }] }, "", "POST")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_address");
  });

  it("409s a duplicate name", async () => {
    const a = await actor();
    const body = { name: "Dup", avatarColor: "#3B82F6" };
    expect((await createPOST(req(a.token, body, "", "POST"))).status).toBe(201);
    const second = await createPOST(req(a.token, body, "", "POST"));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("name_taken");
  });
});

describe("GET /api/contacts", () => {
  it("lists only the caller's contacts", async () => {
    const mine = await actor();
    const theirs = await actor();
    await createPOST(req(mine.token, { name: "Mine", avatarColor: "#3B82F6" }, "", "POST"));
    await createPOST(req(theirs.token, { name: "Theirs", avatarColor: "#EF4444" }, "", "POST"));

    const body = await (await listGET(req(mine.token))).json();
    expect(body.contacts.map((c: { name: string }) => c.name)).toEqual(["Mine"]);
  });

  it("filters by chain so an unpayable contact is never offered", async () => {
    const a = await actor();
    await createPOST(
      req(a.token, { name: "EvmOnly", avatarColor: "#3B82F6", addresses: [{ address: EVM, chain: "base" }] }, "", "POST")
    );
    await createPOST(
      req(a.token, { name: "SolOnly", avatarColor: "#EF4444", addresses: [{ address: SOL, chain: "solana" }] }, "", "POST")
    );

    const evm = await (await listGET(req(a.token, undefined, "?chain=base"))).json();
    expect(evm.contacts.map((c: { name: string }) => c.name)).toEqual(["EvmOnly"]);

    const sol = await (await listGET(req(a.token, undefined, "?chain=solana"))).json();
    expect(sol.contacts.map((c: { name: string }) => c.name)).toEqual(["SolOnly"]);
  });

  it("rejects an unknown chain rather than silently listing everything", async () => {
    const a = await actor();
    const res = await listGET(req(a.token, undefined, "?chain=dogecoin"));
    expect(res.status).toBe(400);
  });

  it("searches by name", async () => {
    const a = await actor();
    await createPOST(req(a.token, { name: "Alice", avatarColor: "#3B82F6" }, "", "POST"));
    await createPOST(req(a.token, { name: "Bob", avatarColor: "#EF4444" }, "", "POST"));
    const body = await (await listGET(req(a.token, undefined, "?q=ali"))).json();
    expect(body.contacts.map((c: { name: string }) => c.name)).toEqual(["Alice"]);
  });
});

describe("PATCH / DELETE /api/contacts/:id", () => {
  async function seed() {
    const a = await actor();
    const created = await (
      await createPOST(
        req(a.token, { name: "Seed", avatarColor: "#3B82F6", addresses: [{ address: EVM, chain: "base" }] }, "", "POST")
      )
    ).json();
    return { ...a, id: created.contact.id as string };
  }

  it("patches whitelisted fields", async () => {
    const s = await seed();
    const res = await contactPATCH(
      req(s.token, { name: "Renamed", isFavorite: true }, "", "PATCH"),
      params(s.id)
    );
    expect(res.status).toBe(200);
    const { contact } = await res.json();
    expect(contact.name).toBe("Renamed");
    expect(contact.isFavorite).toBe(true);
  });

  // Mass assignment — AGENTS.md rule 4. An address written this way would never
  // have passed the per-chain check.
  it("ignores non-whitelisted fields such as addresses and id", async () => {
    const s = await seed();
    const res = await contactPATCH(
      req(
        s.token,
        { name: "Ok", id: "hacked", addresses: [{ address: "0xdead", chain: "base" }], createdAt: 0 },
        "",
        "PATCH"
      ),
      params(s.id)
    );
    expect(res.status).toBe(200);
    const { contact } = await res.json();
    expect(contact.id).toBe(s.id);
    expect(contact.addresses).toHaveLength(1);
    expect(contact.addresses[0].address).toBe(EVM);
  });

  it("400s a patch with no updatable fields", async () => {
    const s = await seed();
    const res = await contactPATCH(req(s.token, {}, "", "PATCH"), params(s.id));
    expect(res.status).toBe(400);
  });

  // Another account's id must be indistinguishable from a nonexistent one.
  it("404s a contact belonging to another account", async () => {
    const s = await seed();
    const other = await actor();
    expect((await contactGET(req(other.token), params(s.id))).status).toBe(404);
    expect((await contactPATCH(req(other.token, { name: "x" }, "", "PATCH"), params(s.id))).status).toBe(404);
    expect((await contactDELETE(req(other.token, undefined, "", "DELETE"), params(s.id))).status).toBe(404);
  });

  it("deletes, then 404s on the second attempt", async () => {
    const s = await seed();
    expect((await contactDELETE(req(s.token, undefined, "", "DELETE"), params(s.id))).status).toBe(200);
    expect((await contactDELETE(req(s.token, undefined, "", "DELETE"), params(s.id))).status).toBe(404);
  });
});
