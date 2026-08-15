// Per-chain-family defaults, and the routes that manage a contact's addresses.
//
// The invariant under test: at most one default address per CHAIN FAMILY, and
// exactly one whenever that family holds any address. A contact-wide default
// leaves the send sheet with nothing to pre-select the moment the user switches
// networks — and no pre-selection is where people go back to pasting.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  addAddress,
  chainKind,
  createContact,
  defaultAddressForChain,
  removeAddress,
  setDefaultAddress,
} from "@/lib/contacts";
import {
  POST as addressPOST,
} from "@/app/api/contacts/[id]/addresses/route";
import {
  DELETE as addressDELETE,
  PATCH as addressPATCH,
} from "@/app/api/contacts/[id]/addresses/[addressId]/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity, type UserAccount } from "@/lib/store";
import type { Contact } from "@/lib/types";

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const EVM2 = "0x1111111111111111111111111111111111111111";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
const SOL2 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function account(): UserAccount {
  const { account } = findOrCreateUserByIdentity({
    email: `caddr-${randomUUID()}@furlpay.test`,
    name: "Address User",
  });
  account.contacts = [];
  return account;
}

function contactWith(a: UserAccount): Contact {
  const res = createContact(a, {
    name: `C-${randomUUID().slice(0, 8)}`,
    avatarColor: "#3B82F6",
  });
  if (!res.ok) throw new Error(`setup failed: ${res.error}`);
  return res.value;
}

describe("per-family defaults", () => {
  it("makes the first address in EACH family its family's default", () => {
    const a = account();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });
    addAddress(a, c.id, { address: SOL, chain: "solana" });
    addAddress(a, c.id, { address: EVM2, chain: "arbitrum" });

    const defaults = c.addresses.filter((x) => x.isDefault);
    expect(defaults).toHaveLength(2);
    expect(defaults.map((d) => chainKind(d.chain)).sort()).toEqual(["evm", "solana"]);
    // The second EVM address must NOT have become a default just because it is
    // on a different chain id — arbitrum and base are the same family.
    expect(c.addresses.find((x) => x.address === EVM2)!.isDefault).toBe(false);
  });

  it("pre-selects the family default for any chain in that family", () => {
    const a = account();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });
    addAddress(a, c.id, { address: SOL, chain: "solana" });

    // Saved on Base, still the right answer when paying on Arbitrum.
    expect(defaultAddressForChain(c, "arbitrum")?.address).toBe(EVM);
    expect(defaultAddressForChain(c, "solana")?.address).toBe(SOL);
  });

  it("returns nothing rather than an address from the wrong family", () => {
    const a = account();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });
    // Falling back to the EVM address here would pre-select a guaranteed
    // failure — the exact mistake the address book exists to prevent.
    expect(defaultAddressForChain(c, "solana")).toBeUndefined();
  });

  it("promotes a successor in the SAME family when a default is removed", () => {
    const a = account();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });
    addAddress(a, c.id, { address: SOL, chain: "solana" });
    addAddress(a, c.id, { address: SOL2, chain: "solana" });

    const solDefault = c.addresses.find((x) => x.address === SOL)!;
    expect(solDefault.isDefault).toBe(true);
    removeAddress(a, c.id, solDefault.id);

    expect(c.addresses.find((x) => x.address === SOL2)!.isDefault).toBe(true);
    // The EVM default is untouched — and was never a candidate.
    expect(c.addresses.find((x) => x.address === EVM)!.isDefault).toBe(true);
  });

  it("leaves the other family alone when the last address of one is removed", () => {
    const a = account();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });
    addAddress(a, c.id, { address: SOL, chain: "solana" });

    const sol = c.addresses.find((x) => x.address === SOL)!;
    removeAddress(a, c.id, sol.id);
    expect(c.addresses).toHaveLength(1);
    expect(c.addresses[0].isDefault).toBe(true);
  });
});

describe("setDefaultAddress", () => {
  it("demotes only the previous default in the same family", () => {
    const a = account();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });
    addAddress(a, c.id, { address: EVM2, chain: "base" });
    addAddress(a, c.id, { address: SOL, chain: "solana" });

    const target = c.addresses.find((x) => x.address === EVM2)!;
    const res = setDefaultAddress(a, c.id, target.id);
    expect(res.ok).toBe(true);

    expect(c.addresses.find((x) => x.address === EVM2)!.isDefault).toBe(true);
    expect(c.addresses.find((x) => x.address === EVM)!.isDefault).toBe(false);
    // A Solana preference is not an EVM preference.
    expect(c.addresses.find((x) => x.address === SOL)!.isDefault).toBe(true);
  });

  it("404s an address id that belongs to another contact", () => {
    const a = account();
    const mine = contactWith(a);
    const theirs = contactWith(a);
    addAddress(a, theirs.id, { address: EVM, chain: "base" });
    const foreign = theirs.addresses[0].id;

    expect(setDefaultAddress(a, mine.id, foreign)).toEqual({ ok: false, error: "not_found" });
  });
});

// ── the routes ────────────────────────────────────────────────────────────

async function actor() {
  const a = account();
  const token = await signSession({
    sub: a.user.id,
    safe: "0x0",
    roles: ["user"],
    jti: randomUUID(),
  });
  return { account: a, token };
}

function req(token: string | undefined, body?: unknown, method = "POST") {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.14.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest("https://furlpay.com/api/contacts/x/addresses", {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const addrParams = (id: string, addressId: string) => ({
  params: Promise.resolve({ id, addressId }),
});

describe("POST /api/contacts/:id/addresses", () => {
  it("401s an unauthenticated request", async () => {
    const res = await addressPOST(req(undefined, { address: EVM, chain: "base" }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("adds a valid address and returns the updated contact", async () => {
    const { account: a, token } = await actor();
    const c = contactWith(a);

    const res = await addressPOST(req(token, { address: EVM, chain: "base", label: "cold" }), {
      params: Promise.resolve({ id: c.id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.address.address).toBe(EVM);
    expect(body.address.label).toBe("cold");
    // First in its family, so it is that family's default.
    expect(body.address.isDefault).toBe(true);
    expect(body.contact.addresses).toHaveLength(1);
  });

  it("400s an address that is not payable on the declared chain", async () => {
    const { account: a, token } = await actor();
    const c = contactWith(a);
    const res = await addressPOST(req(token, { address: SOL, chain: "base" }), {
      params: Promise.resolve({ id: c.id }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_address");
  });

  it("400s a chain the app does not support", async () => {
    const { account: a, token } = await actor();
    const c = contactWith(a);
    // `optimism` is not in the Chain union — it was accepted by the original
    // hand-written enum, which is how an address could be filed under a network
    // nothing else in the app can pay.
    const res = await addressPOST(req(token, { address: EVM, chain: "optimism" }), {
      params: Promise.resolve({ id: c.id }),
    });
    expect(res.status).toBe(400);
  });

  it("409s a duplicate address on the same contact", async () => {
    const { account: a, token } = await actor();
    const c = contactWith(a);
    await addressPOST(req(token, { address: EVM, chain: "base" }), {
      params: Promise.resolve({ id: c.id }),
    });
    const res = await addressPOST(req(token, { address: EVM.toLowerCase(), chain: "base" }), {
      params: Promise.resolve({ id: c.id }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("duplicate_address");
  });

  it("404s another account's contact id", async () => {
    const mine = await actor();
    const theirs = await actor();
    const c = contactWith(theirs.account);

    const res = await addressPOST(req(mine.token, { address: EVM, chain: "base" }), {
      params: Promise.resolve({ id: c.id }),
    });
    expect(res.status).toBe(404);
    // And nothing was written to the other account.
    expect(c.addresses).toHaveLength(0);
  });
});

describe("PATCH/DELETE /api/contacts/:id/addresses/:addressId", () => {
  it("promotes an address to default", async () => {
    const { account: a, token } = await actor();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });
    addAddress(a, c.id, { address: EVM2, chain: "base" });
    const second = c.addresses[1].id;

    const res = await addressPATCH(req(token, { isDefault: true }, "PATCH"), addrParams(c.id, second));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contact.addresses.find((x: { id: string }) => x.id === second).isDefault).toBe(true);
  });

  it("rejects anything other than isDefault:true (no address rewriting)", async () => {
    const { account: a, token } = await actor();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });

    // An `address` field here would be a way past the per-chain check.
    const res = await addressPATCH(
      req(token, { address: SOL, isDefault: true }, "PATCH"),
      addrParams(c.id, c.addresses[0].id)
    );
    // Extra keys are ignored, not applied — the stored address is unchanged.
    expect(res.status).toBe(200);
    expect(c.addresses[0].address).toBe(EVM);
  });

  it("removes an address", async () => {
    const { account: a, token } = await actor();
    const c = contactWith(a);
    addAddress(a, c.id, { address: EVM, chain: "base" });
    const id = c.addresses[0].id;

    const res = await addressDELETE(req(token, undefined, "DELETE"), addrParams(c.id, id));
    expect(res.status).toBe(200);
    expect(c.addresses).toHaveLength(0);
  });

  it("404s an unknown address id", async () => {
    const { account: a, token } = await actor();
    const c = contactWith(a);
    const res = await addressDELETE(req(token, undefined, "DELETE"), addrParams(c.id, randomUUID()));
    expect(res.status).toBe(404);
  });

  it("401s an unauthenticated delete", async () => {
    const res = await addressDELETE(req(undefined, undefined, "DELETE"), addrParams("x", "y"));
    expect(res.status).toBe(401);
  });
});
