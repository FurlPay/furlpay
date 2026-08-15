import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { Contact, ContactAddress } from "@/lib/types";
import type { UserAccount } from "@/lib/store";
import type { Chain } from "@furlpay/types";
import { classifyAddress } from "@/lib/addressValidation";
import {
  AVATAR_COLORS,
  CHAINS,
  MAX_ADDRESSES_PER_CONTACT,
  MAX_CONTACTS,
  MAX_NAME_LENGTH,
  addressKey,
  chainKind,
  isContactChain,
} from "@/lib/contactConstants";

// ---------------------------------------------------------------------------
// Address-book business logic.
//
// A contact is a SAFETY control before it is a convenience: the mistake it
// removes is paying a 42-character string that looked right. Two rules follow
// from that and are enforced here rather than in the routes, so no caller can
// skip them:
//
//   1. An address is only stored if it is payable ON ITS DECLARED CHAIN. A
//      contact holding an unpayable address is worse than no contact — it looks
//      authoritative and fails at submit.
//   2. The same address is never stored twice on one contact, and a contact
//      never shares a name with another under the same account. Both are
//      ambiguity the send sheet cannot resolve for the user.
//
// Contacts live on UserAccount (like cards and bills) and are persisted by
// storeDb; nothing here touches the database directly.
// ---------------------------------------------------------------------------

// The palette, the chain list, the limits and the two key helpers live in
// lib/contactConstants.ts — pure, browser-safe, and shared with the UI so a
// component can never offer a colour or chain this module would reject. They
// are re-exported here so existing server callers keep one import.
export {
  AVATAR_COLORS,
  CHAINS,
  MAX_ADDRESSES_PER_CONTACT,
  MAX_CONTACTS,
  MAX_NAME_LENGTH,
  addressKey,
  chainKind,
  isContactChain,
};

/** Contacts always accessed through here — the field is optional on older
 *  accounts (see UserAccount.contacts) and every reader wants an array. */
export function contactsFor(account: UserAccount): Contact[] {
  if (!account.contacts) account.contacts = [];
  return account.contacts;
}

const nameKey = (name: string) => name.trim().toLowerCase();

export type ContactError =
  | "name_taken"
  | "contact_limit_reached"
  | "address_limit_reached"
  | "invalid_address"
  | "duplicate_address"
  | "not_found";

export type ContactResult<T> = { ok: true; value: T } | { ok: false; error: ContactError };

/**
 * Map a domain error to a response. 409 for a conflict the user can resolve by
 * changing something, 400 for input that could never be stored, 404 for an id
 * that is not theirs — deliberately indistinguishable from one that does not
 * exist, so the endpoint cannot be used to probe other accounts' contact ids.
 */
export function contactErrorResponse(error: ContactError): NextResponse {
  const map: Record<ContactError, { status: number; message: string }> = {
    name_taken: { status: 409, message: "You already have a contact with that name." },
    contact_limit_reached: { status: 409, message: "Contact limit reached." },
    address_limit_reached: {
      status: 409,
      message: `A contact can hold at most ${MAX_ADDRESSES_PER_CONTACT} addresses.`,
    },
    duplicate_address: { status: 409, message: "That address is already saved to this contact." },
    invalid_address: { status: 400, message: "That address is not valid on the selected network." },
    not_found: { status: 404, message: "Contact not found." },
  };
  const { status, message } = map[error];
  return NextResponse.json({ error, message }, { status });
}

export interface NewContactInput {
  name: string;
  avatarColor: string;
  addresses?: { address: string; chain: Chain; label?: string }[];
}

/**
 * `isDefault` is scoped to the CHAIN FAMILY, not the contact.
 *
 * A contact with one EVM address and one Solana address needs a preferred
 * address on each: a single contact-wide default leaves the send sheet with
 * nothing to pre-select the moment the user switches networks, and "no
 * pre-selection" is where they start pasting addresses again. So: at most one
 * default per family, and exactly one whenever that family has any address.
 */
function isFirstInFamily(addresses: ContactAddress[], chain: Chain): boolean {
  const kind = chainKind(chain);
  return !addresses.some((a) => chainKind(a.chain) === kind);
}

/**
 * Validate and normalise one address entry. Returns null when the address is
 * not payable on the declared chain — the check that stops an EVM address being
 * saved under `solana` (and vice versa) purely because a client sent it.
 */
function buildAddress(
  input: { address: string; chain: Chain; label?: string },
  isDefault: boolean
): ContactAddress | null {
  const address = input.address.trim();
  if (classifyAddress(address) !== chainKind(input.chain)) return null;
  return {
    id: randomUUID(),
    address,
    chain: input.chain,
    ...(input.label?.trim() ? { label: input.label.trim().slice(0, 40) } : {}),
    isDefault,
  };
}

export function createContact(
  account: UserAccount,
  input: NewContactInput
): ContactResult<Contact> {
  const contacts = contactsFor(account);
  if (contacts.length >= MAX_CONTACTS) return { ok: false, error: "contact_limit_reached" };

  const name = input.name.trim();
  if (contacts.some((c) => nameKey(c.name) === nameKey(name))) {
    return { ok: false, error: "name_taken" };
  }

  const incoming = input.addresses ?? [];
  if (incoming.length > MAX_ADDRESSES_PER_CONTACT) {
    return { ok: false, error: "address_limit_reached" };
  }

  const addresses: ContactAddress[] = [];
  const seen = new Set<string>();
  for (const entry of incoming) {
    const built = buildAddress(entry, isFirstInFamily(addresses, entry.chain));
    if (!built) return { ok: false, error: "invalid_address" };
    const key = addressKey(built.address, built.chain);
    if (seen.has(key)) return { ok: false, error: "duplicate_address" };
    seen.add(key);
    addresses.push(built);
  }

  const now = Date.now();
  const contact: Contact = {
    id: randomUUID(),
    name: name.slice(0, MAX_NAME_LENGTH),
    avatarColor: input.avatarColor,
    addresses,
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
  };
  contacts.push(contact);
  return { ok: true, value: contact };
}

export function findContact(account: UserAccount, id: string): Contact | undefined {
  return contactsFor(account).find((c) => c.id === id);
}

export interface ContactPatch {
  name?: string;
  avatarColor?: string;
  isFavorite?: boolean;
}

/** Whitelisted update — AGENTS.md rule 4. `addresses`, `id` and the timestamps
 *  are NOT patchable here; addresses go through addAddress/removeAddress so
 *  every stored address has passed validation. */
export function updateContact(
  account: UserAccount,
  id: string,
  patch: ContactPatch
): ContactResult<Contact> {
  const contact = findContact(account, id);
  if (!contact) return { ok: false, error: "not_found" };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    const clash = contactsFor(account).some(
      (c) => c.id !== id && nameKey(c.name) === nameKey(name)
    );
    if (clash) return { ok: false, error: "name_taken" };
    contact.name = name.slice(0, MAX_NAME_LENGTH);
  }
  if (patch.avatarColor !== undefined) contact.avatarColor = patch.avatarColor;
  if (patch.isFavorite !== undefined) contact.isFavorite = patch.isFavorite;

  contact.updatedAt = Date.now();
  return { ok: true, value: contact };
}

export function deleteContact(account: UserAccount, id: string): boolean {
  const contacts = contactsFor(account);
  const index = contacts.findIndex((c) => c.id === id);
  if (index === -1) return false;
  contacts.splice(index, 1);
  return true;
}

export function addAddress(
  account: UserAccount,
  contactId: string,
  input: { address: string; chain: Chain; label?: string }
): ContactResult<ContactAddress> {
  const contact = findContact(account, contactId);
  if (!contact) return { ok: false, error: "not_found" };
  if (contact.addresses.length >= MAX_ADDRESSES_PER_CONTACT) {
    return { ok: false, error: "address_limit_reached" };
  }

  const built = buildAddress(input, isFirstInFamily(contact.addresses, input.chain));
  if (!built) return { ok: false, error: "invalid_address" };

  const key = addressKey(built.address, built.chain);
  if (contact.addresses.some((a) => addressKey(a.address, a.chain) === key)) {
    return { ok: false, error: "duplicate_address" };
  }

  contact.addresses.push(built);
  contact.updatedAt = Date.now();
  return { ok: true, value: built };
}

export function removeAddress(
  account: UserAccount,
  contactId: string,
  addressId: string
): ContactResult<Contact> {
  const contact = findContact(account, contactId);
  if (!contact) return { ok: false, error: "not_found" };
  const index = contact.addresses.findIndex((a) => a.id === addressId);
  if (index === -1) return { ok: false, error: "not_found" };

  const [removed] = contact.addresses.splice(index, 1);
  // Removing the default must promote another IN THE SAME FAMILY, or the
  // contact silently has no preferred address on that network and the send
  // sheet has nothing to pre-select. Promoting across families would be worse
  // than nothing: it pre-selects an address that cannot receive the send.
  if (removed.isDefault) {
    const kind = chainKind(removed.chain);
    const successor = contact.addresses.find((a) => chainKind(a.chain) === kind);
    if (successor) successor.isDefault = true;
  }
  contact.updatedAt = Date.now();
  return { ok: true, value: contact };
}

/**
 * Make `addressId` the preferred address for its chain family, demoting the
 * previous default in that family only — a contact's EVM preference says
 * nothing about which Solana address they want paid.
 */
export function setDefaultAddress(
  account: UserAccount,
  contactId: string,
  addressId: string
): ContactResult<Contact> {
  const contact = findContact(account, contactId);
  if (!contact) return { ok: false, error: "not_found" };
  const target = contact.addresses.find((a) => a.id === addressId);
  if (!target) return { ok: false, error: "not_found" };

  const kind = chainKind(target.chain);
  for (const address of contact.addresses) {
    if (chainKind(address.chain) === kind) address.isDefault = address.id === target.id;
  }
  contact.updatedAt = Date.now();
  return { ok: true, value: contact };
}

/**
 * The address to pre-select when paying this contact on `chain`: the family
 * default, else the first payable one. Returns undefined when the contact holds
 * nothing payable on that network — the caller must NOT fall back to another
 * family's address.
 */
export function defaultAddressForChain(contact: Contact, chain: Chain): ContactAddress | undefined {
  const kind = chainKind(chain);
  const payable = contact.addresses.filter((a) => chainKind(a.chain) === kind);
  return payable.find((a) => a.isDefault) ?? payable[0];
}

/**
 * Contacts holding at least one address payable on `chain`, with the
 * non-matching addresses stripped.
 *
 * This is the "smart routing" the send sheet needs: offering a contact whose
 * only address is on another chain invites exactly the mistake the address book
 * exists to prevent.
 */
export function contactsForChain(account: UserAccount, chain: Chain): Contact[] {
  const kind = chainKind(chain);
  return contactsFor(account)
    .map((c) => ({
      ...c,
      addresses: c.addresses.filter((a) => chainKind(a.chain) === kind),
    }))
    .filter((c) => c.addresses.length > 0);
}

/** Case-insensitive substring search over names, favourites first. */
export function searchContacts(account: UserAccount, query: string): Contact[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? contactsFor(account).filter((c) => c.name.toLowerCase().includes(q))
    : [...contactsFor(account)];
  return matches.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** The contact (if any) that owns `address` on `chain` — used to show a name
 *  instead of a hex string on the confirmation screen. */
export function findContactByAddress(
  account: UserAccount,
  address: string,
  chain: Chain
): Contact | undefined {
  const key = addressKey(address, chain);
  return contactsFor(account).find((c) =>
    c.addresses.some((a) => addressKey(a.address, a.chain) === key)
  );
}
