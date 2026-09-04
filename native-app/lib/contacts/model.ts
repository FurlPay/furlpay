import { EVM_ADDRESS_RE, SOLANA_ADDRESS_RE } from "@/lib/format";
import type { Chain } from "@/lib/types";

// ---------------------------------------------------------------------------
// Address book — the pure half.
//
// Mirrors apps/web/src/lib/contactConstants.ts, which is the module the SERVER
// validates against. Everything here is dependency-free so it can be unit
// tested directly, and so no screen can offer a colour, a chain or a name
// length the API would then reject with a 400.
//
// WHY THE APP NEEDS THIS AT ALL. The address book is a SAFETY control before it
// is a convenience: the mistake it removes is paying a 42-character string that
// looked right. lib/send/recipients.ts already holds the addresses this device
// has paid, which is what makes look-alike detection possible — but that list
// is local, unnamed, capped at eight, and wiped on sign-out. A contact is the
// same address with a name the user chose, stored on the account, and reachable
// from the moment they open Send rather than only after they have already paid
// someone once.
//
// TWO RULES CARRIED OVER FROM THE SERVER, because a client that does not know
// them produces a form that fails at submit:
//   1. An address is only valid ON ITS DECLARED CHAIN. An EVM address saved
//      under `solana` is not a contact, it is a trap.
//   2. `isDefault` is scoped to the CHAIN FAMILY, not the contact. A contact
//      with an EVM address and a Solana address needs a preferred address on
//      each; a single contact-wide default leaves the send sheet with nothing
//      to pre-select the moment the user switches networks.
// ---------------------------------------------------------------------------

/** Which chain family a chain id belongs to. Solana is the only non-EVM one. */
export type AddressChainKind = "evm" | "solana";

/**
 * Chains a contact address may declare — every chain FurlPay knows, and only
 * those.
 *
 * `satisfies readonly Chain[]` rejects a chain that does not exist; the
 * exhaustiveness check below rejects a chain the app supports but this list
 * forgot. Both guards exist on the server for the same reason: a hand-written
 * copy of this list once included `optimism`, which the API then accepted and
 * stored on a network nothing in the app can pay.
 */
export const CONTACT_CHAINS = [
  "ethereum",
  "polygon",
  "base",
  "arbitrum",
  "solana",
  "gnosis",
  "robinhood",
  "bsc",
] as const satisfies readonly Chain[];

/** Compile error if a member of `Chain` is missing from CONTACT_CHAINS. */
type MissingChain = Exclude<Chain, (typeof CONTACT_CHAINS)[number]>;
const _chainsAreExhaustive: MissingChain extends never ? true : MissingChain = true;
void _chainsAreExhaustive;

/**
 * The palette the API accepts (`z.enum(AVATAR_COLORS)` in
 * apps/web/src/app/api/contacts/route.ts). Offering anything else here is a 400
 * the user cannot interpret.
 */
export const AVATAR_COLORS = [
  "#3B82F6",
  "#06B6D4",
  "#A78BFA",
  "#8B5CF6",
  "#D946EF",
  "#6366F1",
  "#7C3AED",
  "#EC4899",
  "#EF4444",
  "#EAB308",
  "#22C55E",
  "#16A34A",
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Mirrors the database CHECK in migration 0010 and the server's own caps. */
export const MAX_ADDRESSES_PER_CONTACT = 20;
export const MAX_CONTACTS = 500;
export const MAX_NAME_LENGTH = 64;
export const MAX_LABEL_LENGTH = 40;

export interface ContactAddress {
  id: string;
  address: string;
  chain: Chain;
  label?: string;
  isDefault: boolean;
}

export interface Contact {
  id: string;
  name: string;
  avatarColor: string;
  addresses: ContactAddress[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export function chainKind(chain: Chain): AddressChainKind {
  return chain === "solana" ? "solana" : "evm";
}

/**
 * Which family an arbitrary string is payable in, or null when it is payable in
 * neither. Uses the same shape checks lib/format.ts applies to the send field,
 * so a contact can never hold an address the send screen would then reject.
 */
export function classifyAddress(address: string): AddressChainKind | null {
  const trimmed = address.trim();
  if (EVM_ADDRESS_RE.test(trimmed)) return "evm";
  if (SOLANA_ADDRESS_RE.test(trimmed)) return "solana";
  return null;
}

/**
 * Every chain this address could belong to.
 *
 * Tangem's address book derives the network list from the address and this is
 * the right call: the string already answers the question, so asking the user
 * to also name the network is asking them to answer it twice — and a wrong
 * answer is stored as an unpayable contact. The picker is still shown, because
 * one EVM address is valid on seven networks and only the user knows which one
 * they mean, but it is pre-filtered to the chains that can actually receive it.
 *
 * Returns [] for an unpayable string, which is what the form needs to render
 * the "not a valid address" state without a second check.
 */
export function chainsForAddress(address: string): Chain[] {
  const kind = classifyAddress(address);
  if (!kind) return [];
  return CONTACT_CHAINS.filter((chain) => chainKind(chain) === kind);
}

/**
 * Normalised comparison key. EVM addresses are case-insensitive (EIP-55 is a
 * checksum, not an identity); base58 is case-SENSITIVE and folding it would
 * merge two genuinely different Solana accounts.
 */
export function addressKey(address: string, chain: Chain): string {
  const trimmed = address.trim();
  const normalised = chainKind(chain) === "evm" ? trimmed.toLowerCase() : trimmed;
  return `${chain}:${normalised}`;
}

/**
 * The address to pre-select when paying this contact on `chain`: the family
 * default, else the first payable one.
 *
 * Returns undefined when the contact holds nothing payable on that network.
 * Callers MUST NOT fall back to another family's address — pre-selecting one
 * that cannot receive the send is worse than pre-selecting nothing.
 */
export function defaultAddressForChain(
  contact: Contact,
  chain: Chain
): ContactAddress | undefined {
  const kind = chainKind(chain);
  const payable = contact.addresses.filter((a) => chainKind(a.chain) === kind);
  return payable.find((a) => a.isDefault) ?? payable[0];
}

/** Every address on this contact that could receive a payment on `chain`. */
export function addressesForChain(contact: Contact, chain: Chain): ContactAddress[] {
  const kind = chainKind(chain);
  return contact.addresses.filter((a) => chainKind(a.chain) === kind);
}

/**
 * Contacts holding at least one address payable on `chain`, with the
 * non-matching addresses stripped.
 *
 * The send sheet's filter. Offering a contact whose only address is on another
 * network invites exactly the mistake the address book exists to prevent. The
 * server's `GET /contacts?chain=` applies the same rule; this exists so a
 * cached list can be filtered without a round trip.
 */
export function contactsForChain(contacts: Contact[], chain: Chain): Contact[] {
  const kind = chainKind(chain);
  return contacts
    .map((c) => ({ ...c, addresses: c.addresses.filter((a) => chainKind(a.chain) === kind) }))
    .filter((c) => c.addresses.length > 0);
}

/**
 * Local search, favourites first then alphabetical — the same ordering the
 * server's `searchContacts` returns, so a locally-filtered list and a
 * server-filtered one never disagree about where a row sits.
 *
 * Matches the ADDRESS as well as the name. Tangem does this and it closes a
 * real gap: the user has an address on the clipboard and wants to know whether
 * it already belongs to someone they know — a question a name search cannot
 * answer.
 */
export function searchContacts(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.addresses.some((a) => a.address.toLowerCase().includes(q))
      )
    : [...contacts];
  return matches.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The contact (if any) that owns `address` on `chain`.
 *
 * This is what turns a hex string into a name on the confirmation screen, and
 * it is the strongest signal the send screen has: a name the user chose
 * themselves outranks any resolver. It also extends look-alike protection
 * (lib/send/lookalike.ts) to addresses the user has saved but not yet paid.
 */
export function findContactByAddress(
  contacts: Contact[],
  address: string,
  chain: Chain
): Contact | undefined {
  const key = addressKey(address, chain);
  return contacts.find((c) => c.addresses.some((a) => addressKey(a.address, a.chain) === key));
}

/**
 * Palette entry for a new contact, chosen so two contacts created back to back
 * do not both come out the same blue.
 */
export function suggestAvatarColor(existing: Contact[]): AvatarColor {
  return AVATAR_COLORS[existing.length % AVATAR_COLORS.length];
}

/**
 * The letter shown on the avatar. Never empty: a contact named "🙂" would
 * otherwise render a blank circle.
 */
export function contactInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

/**
 * Client-side name check matching the server's rules, so the user is told
 * BEFORE the request rather than by a 409 after it. Returns null when valid.
 */
export function nameError(name: string, existing: Contact[], selfId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give this contact a name.";
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Names are at most ${MAX_NAME_LENGTH} characters.`;
  }
  const key = trimmed.toLowerCase();
  if (existing.some((c) => c.id !== selfId && c.name.trim().toLowerCase() === key)) {
    return "You already have a contact with that name.";
  }
  return null;
}

/**
 * Client-side duplicate check for an address about to be added to `contact`.
 * The server returns 409 `duplicate_address` for the same case; catching it
 * here means the user finds out while the field is still focused.
 */
export function duplicateAddressError(
  contact: Contact,
  address: string,
  chain: Chain
): string | null {
  const key = addressKey(address, chain);
  return contact.addresses.some((a) => addressKey(a.address, a.chain) === key)
    ? "That address is already saved to this contact."
    : null;
}
