import { api, ApiError } from "@/lib/api";
import type { Chain } from "@/lib/types";
import type { AvatarColor, Contact, ContactAddress } from "./model";

// ---------------------------------------------------------------------------
// Address-book transport.
//
// Every endpoint below was read out of apps/web/src/app/api/contacts/**, not
// transcribed from a document, so the two sides cannot drift. The server is the
// authority on all of it: the client-side checks in ./model exist to tell the
// user sooner, never to decide.
//
// NOTHING HERE IS CACHED BY HAND. Reads go through react-query (./useContacts)
// so the address book participates in the same invalidation the rest of the app
// uses, and so `queryClient.clear()` on a session boundary wipes it — a second
// account on a shared device must never be offered the first account's payees.
// That is the same reason lib/send/recipients.ts lives in kv_cache rather than
// SecureStore.
// ---------------------------------------------------------------------------

interface ContactsResponse {
  contacts: Contact[];
}

interface ContactResponse {
  contact: Contact;
}

/**
 * The caller's address book.
 *
 * `chain` filters to contacts payable on that chain AND strips their addresses
 * on other chains — which is what the send sheet wants. Passing it is not an
 * optimisation: offering a contact whose only address is on another network
 * invites the very mistake contacts prevent.
 */
export async function fetchContacts(
  opts: { chain?: Chain; query?: string; signal?: AbortSignal } = {}
): Promise<Contact[]> {
  const params = new URLSearchParams();
  if (opts.chain) params.set("chain", opts.chain);
  if (opts.query?.trim()) params.set("q", opts.query.trim());
  const qs = params.toString();
  const res = await api<ContactsResponse>(`/contacts${qs ? `?${qs}` : ""}`, {
    signal: opts.signal,
  });
  return res.contacts ?? [];
}

export async function fetchContact(id: string): Promise<Contact> {
  const res = await api<ContactResponse>(`/contacts/${encodeURIComponent(id)}`);
  return res.contact;
}

export interface NewContactInput {
  name: string;
  avatarColor: AvatarColor;
  addresses?: { address: string; chain: Chain; label?: string }[];
}

export async function createContact(input: NewContactInput): Promise<Contact> {
  const res = await api<ContactResponse>("/contacts", { method: "POST", body: input });
  return res.contact;
}

/**
 * Rename, recolour, favourite.
 *
 * `addresses` is deliberately absent — the server refuses it too (AGENTS.md
 * rule 4). An address that arrived by PATCH would never have passed the
 * per-chain payability check, which is the whole point of the address book.
 */
export async function patchContact(
  id: string,
  patch: { name?: string; avatarColor?: AvatarColor; isFavorite?: boolean }
): Promise<Contact> {
  const res = await api<ContactResponse>(`/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });
  return res.contact;
}

export async function deleteContact(id: string): Promise<void> {
  await api(`/contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Add one address. Returns the WHOLE contact, not just the new address: adding
 * the first address in a chain family makes it that family's default, and the
 * caller needs the updated list to render that correctly.
 */
export async function addContactAddress(
  contactId: string,
  input: { address: string; chain: Chain; label?: string }
): Promise<Contact> {
  const res = await api<{ address: ContactAddress; contact: Contact }>(
    `/contacts/${encodeURIComponent(contactId)}/addresses`,
    { method: "POST", body: input }
  );
  return res.contact;
}

export async function removeContactAddress(
  contactId: string,
  addressId: string
): Promise<Contact> {
  const res = await api<ContactResponse>(
    `/contacts/${encodeURIComponent(contactId)}/addresses/${encodeURIComponent(addressId)}`,
    { method: "DELETE" }
  );
  return res.contact;
}

/** Make this the preferred address for its chain family. */
export async function setDefaultContactAddress(
  contactId: string,
  addressId: string
): Promise<Contact> {
  const res = await api<ContactResponse>(
    `/contacts/${encodeURIComponent(contactId)}/addresses/${encodeURIComponent(addressId)}`,
    { method: "PATCH", body: { isDefault: true } }
  );
  return res.contact;
}

// ── name resolution ────────────────────────────────────────────────────────

/**
 * What GET /contacts/resolve can answer.
 *
 * `unavailable` is NOT `unresolved`, and collapsing the two would be
 * fabricating a result: the lookup failed, so we do not know that the name is
 * unregistered. The server returns 503 for it precisely so the client can say
 * "we could not check" instead of "no such name".
 */
export type ResolveOutcome =
  | {
      status: "resolved";
      address: string;
      kind: string;
      family: "evm" | "solana";
      display: string;
      /** False when the resolved address cannot receive on the chain asked
       *  about — an ENS name is worthless to a Solana send. */
      payableOnChain: boolean;
      /** Set when the address is already in the caller's own address book. */
      contact?: { id: string; name: string; avatarColor: string };
    }
  | { status: "unresolved" }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string };

/**
 * Turn whatever the user typed into the "To" field into a payable address — a
 * raw address, an ENS name, or a FurlPay name.
 *
 * Never throws for a resolution outcome; every answer including failure is a
 * value, because "the resolver is down" is something the send screen has to
 * render rather than something it can crash on. A genuine transport failure
 * still propagates, so the offline path stays distinguishable.
 */
export async function resolveRecipientName(
  name: string,
  chain?: Chain,
  signal?: AbortSignal
): Promise<ResolveOutcome> {
  const params = new URLSearchParams({ name });
  if (chain) params.set("chain", chain);
  try {
    const res = await api<{
      resolved: true;
      kind: string;
      address: string;
      family: "evm" | "solana";
      display: string;
      payableOnChain: boolean;
      contact?: { id: string; name: string; avatarColor: string };
    }>(`/contacts/resolve?${params.toString()}`, { signal });
    return {
      status: "resolved",
      address: res.address,
      kind: res.kind,
      family: res.family,
      display: res.display,
      payableOnChain: res.payableOnChain,
      ...(res.contact ? { contact: res.contact } : {}),
    };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 404) return { status: "unresolved" };
      if (e.status === 503) {
        return {
          status: "unavailable",
          message:
            (e.data as { message?: string } | null)?.message ??
            "We could not check that name right now.",
        };
      }
      if (e.status === 400) {
        return {
          status: "invalid",
          message:
            (e.data as { message?: string } | null)?.message ?? "That is not a name we can look up.",
        };
      }
    }
    throw e;
  }
}

// ── recent recipients (server-side) ────────────────────────────────────────

export interface ServerRecentRecipient {
  address: string;
  chain: Chain;
  lastPaidAt?: string;
  count?: number;
  contact?: { id: string; name: string; avatarColor: string };
}

/**
 * Addresses the account has actually paid, annotated with the matching
 * address-book entry when there is one.
 *
 * `durable: false` means the payments table is not present on this deployment,
 * so there is no history to read. It is NOT "you have paid nobody", and the
 * caller must say so rather than render an empty state — hence the flag is
 * returned rather than swallowed.
 *
 * This is a SUPPLEMENT to lib/send/recipients.ts, not a replacement. The local
 * list is what look-alike detection compares against and it must keep working
 * offline; this one adds the payees made on other devices.
 */
export async function fetchServerRecents(
  chain?: Chain,
  signal?: AbortSignal
): Promise<{ recents: ServerRecentRecipient[]; durable: boolean }> {
  const qs = chain ? `?chain=${encodeURIComponent(chain)}` : "";
  const res = await api<{ recents: ServerRecentRecipient[]; durable: boolean }>(
    `/contacts/recent${qs}`,
    { signal }
  );
  return { recents: res.recents ?? [], durable: res.durable !== false };
}
