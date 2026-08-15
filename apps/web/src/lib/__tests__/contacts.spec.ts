// Address-book rules. These are the invariants that make a contact a SAFETY
// control rather than a convenience: an address is stored only if it is payable
// on its declared chain, and neither names nor addresses may be ambiguous.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  addAddress,
  addressKey,
  chainKind,
  contactsFor,
  contactsForChain,
  createContact,
  deleteContact,
  findContactByAddress,
  removeAddress,
  searchContacts,
  updateContact,
  MAX_ADDRESSES_PER_CONTACT,
} from "@/lib/contacts";
import { findOrCreateUserByIdentity } from "@/lib/store";

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const EVM2 = "0x1111111111111111111111111111111111111111";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

function account() {
  const { account } = findOrCreateUserByIdentity({
    email: `contacts-${randomUUID()}@furlpay.test`,
    name: "Contacts User",
  });
  account.contacts = [];
  return account;
}

describe("createContact", () => {
  it("creates a contact with a validated address", () => {
    const a = account();
    const res = createContact(a, {
      name: "Alice",
      avatarColor: "#3B82F6",
      addresses: [{ address: EVM, chain: "base" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.name).toBe("Alice");
    expect(res.value.addresses).toHaveLength(1);
    // First address becomes the default, or nothing is pre-selectable.
    expect(res.value.addresses[0].isDefault).toBe(true);
    expect(contactsFor(a)).toHaveLength(1);
  });

  // The core safety rule: a contact holding an unpayable address looks
  // authoritative and fails only at submit.
  it("rejects an address that is not payable on its declared chain", () => {
    const a = account();
    expect(
      createContact(a, { name: "X", avatarColor: "#3B82F6", addresses: [{ address: SOL, chain: "base" }] })
    ).toEqual({ ok: false, error: "invalid_address" });
    expect(
      createContact(a, { name: "Y", avatarColor: "#3B82F6", addresses: [{ address: EVM, chain: "solana" }] })
    ).toEqual({ ok: false, error: "invalid_address" });
    expect(
      createContact(a, { name: "Z", avatarColor: "#3B82F6", addresses: [{ address: "0xdead", chain: "base" }] })
    ).toEqual({ ok: false, error: "invalid_address" });
    expect(contactsFor(a)).toHaveLength(0);
  });

  it("rejects a duplicate name, case-insensitively", () => {
    const a = account();
    createContact(a, { name: "Dad", avatarColor: "#3B82F6" });
    expect(createContact(a, { name: "dad", avatarColor: "#EF4444" })).toEqual({
      ok: false,
      error: "name_taken",
    });
    expect(createContact(a, { name: "  DAD  ", avatarColor: "#EF4444" })).toEqual({
      ok: false,
      error: "name_taken",
    });
  });

  it("rejects the same address listed twice on one contact", () => {
    const a = account();
    const res = createContact(a, {
      name: "Dup",
      avatarColor: "#3B82F6",
      addresses: [
        { address: EVM, chain: "base" },
        { address: EVM.toLowerCase(), chain: "base" }, // EIP-55 casing is not a new address
      ],
    });
    expect(res).toEqual({ ok: false, error: "duplicate_address" });
  });

  it("allows the same address on DIFFERENT chains", () => {
    const a = account();
    const res = createContact(a, {
      name: "Multi",
      avatarColor: "#3B82F6",
      addresses: [
        { address: EVM, chain: "base" },
        { address: EVM, chain: "arbitrum" },
      ],
    });
    expect(res.ok).toBe(true);
  });

  it("enforces the per-contact address ceiling", () => {
    const a = account();
    const many = Array.from({ length: MAX_ADDRESSES_PER_CONTACT + 1 }, () => ({
      address: EVM,
      chain: "base" as const,
    }));
    expect(createContact(a, { name: "Many", avatarColor: "#3B82F6", addresses: many })).toEqual({
      ok: false,
      error: "address_limit_reached",
    });
  });
});

describe("updateContact", () => {
  it("patches only whitelisted fields", () => {
    const a = account();
    const created = createContact(a, {
      name: "Bob",
      avatarColor: "#3B82F6",
      addresses: [{ address: EVM, chain: "base" }],
    });
    if (!created.ok) throw new Error("setup failed");

    const res = updateContact(a, created.value.id, { name: "Bobby", isFavorite: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.name).toBe("Bobby");
    expect(res.value.isFavorite).toBe(true);
    // Addresses are not patchable through this path.
    expect(res.value.addresses).toHaveLength(1);
    expect(res.value.addresses[0].address).toBe(EVM);
  });

  it("rejects a rename onto another contact's name but allows a no-op rename", () => {
    const a = account();
    const one = createContact(a, { name: "One", avatarColor: "#3B82F6" });
    createContact(a, { name: "Two", avatarColor: "#EF4444" });
    if (!one.ok) throw new Error("setup failed");

    expect(updateContact(a, one.value.id, { name: "Two" })).toEqual({ ok: false, error: "name_taken" });
    expect(updateContact(a, one.value.id, { name: "One" }).ok).toBe(true);
  });

  it("404s an unknown id", () => {
    expect(updateContact(account(), "nope", { name: "x" })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("addresses", () => {
  it("promotes a new default when the default is removed", () => {
    const a = account();
    const created = createContact(a, {
      name: "Carol",
      avatarColor: "#3B82F6",
      addresses: [{ address: EVM, chain: "base" }],
    });
    if (!created.ok) throw new Error("setup failed");
    addAddress(a, created.value.id, { address: EVM2, chain: "base" });

    const defaultId = created.value.addresses[0].id;
    const res = removeAddress(a, created.value.id, defaultId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.addresses).toHaveLength(1);
    expect(res.value.addresses[0].isDefault).toBe(true);
  });

  it("rejects a duplicate or invalid address on add", () => {
    const a = account();
    const created = createContact(a, {
      name: "Dave",
      avatarColor: "#3B82F6",
      addresses: [{ address: EVM, chain: "base" }],
    });
    if (!created.ok) throw new Error("setup failed");

    expect(addAddress(a, created.value.id, { address: EVM, chain: "base" })).toEqual({
      ok: false,
      error: "duplicate_address",
    });
    expect(addAddress(a, created.value.id, { address: SOL, chain: "base" })).toEqual({
      ok: false,
      error: "invalid_address",
    });
  });
});

describe("deleteContact", () => {
  it("removes the contact and reports whether it existed", () => {
    const a = account();
    const created = createContact(a, { name: "Erin", avatarColor: "#3B82F6" });
    if (!created.ok) throw new Error("setup failed");
    expect(deleteContact(a, created.value.id)).toBe(true);
    expect(deleteContact(a, created.value.id)).toBe(false);
    expect(contactsFor(a)).toHaveLength(0);
  });
});

describe("contactsForChain", () => {
  // Offering a contact whose only address is on another chain invites exactly
  // the mistake the address book exists to prevent.
  it("hides contacts with no address on the chain and strips mismatched ones", () => {
    const a = account();
    createContact(a, {
      name: "EvmOnly",
      avatarColor: "#3B82F6",
      addresses: [{ address: EVM, chain: "base" }],
    });
    createContact(a, {
      name: "SolOnly",
      avatarColor: "#EF4444",
      addresses: [{ address: SOL, chain: "solana" }],
    });

    const evm = contactsForChain(a, "base");
    expect(evm.map((c) => c.name)).toEqual(["EvmOnly"]);

    const sol = contactsForChain(a, "solana");
    expect(sol.map((c) => c.name)).toEqual(["SolOnly"]);
    expect(sol[0].addresses.every((x) => x.chain === "solana")).toBe(true);
  });
});

describe("searchContacts", () => {
  it("matches case-insensitively and puts favourites first", () => {
    const a = account();
    createContact(a, { name: "Zoe", avatarColor: "#3B82F6" });
    const fav = createContact(a, { name: "alice", avatarColor: "#EF4444" });
    if (!fav.ok) throw new Error("setup failed");
    updateContact(a, fav.value.id, { isFavorite: true });

    expect(searchContacts(a, "AL").map((c) => c.name)).toEqual(["alice"]);
    expect(searchContacts(a, "").map((c) => c.name)).toEqual(["alice", "Zoe"]);
  });
});

describe("findContactByAddress / addressKey", () => {
  it("resolves an address to its contact regardless of EVM casing", () => {
    const a = account();
    createContact(a, {
      name: "Frank",
      avatarColor: "#3B82F6",
      addresses: [{ address: EVM, chain: "base" }],
    });
    expect(findContactByAddress(a, EVM.toLowerCase(), "base")?.name).toBe("Frank");
    // Different chain → not the same saved address.
    expect(findContactByAddress(a, EVM, "polygon")).toBeUndefined();
  });

  // base58 is case-SENSITIVE; folding it would collide distinct Solana keys.
  it("does not case-fold Solana addresses", () => {
    expect(addressKey(SOL, "solana")).not.toBe(addressKey(SOL.toLowerCase(), "solana"));
    expect(addressKey(EVM, "base")).toBe(addressKey(EVM.toLowerCase(), "base"));
  });

  it("classifies chain families", () => {
    expect(chainKind("solana")).toBe("solana");
    expect(chainKind("base")).toBe("evm");
    expect(chainKind("arbitrum")).toBe("evm");
  });
});
