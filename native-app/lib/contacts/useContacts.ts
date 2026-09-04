import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, NetworkError } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/db";
import type { Chain } from "@/lib/types";
import {
  addContactAddress,
  createContact,
  deleteContact,
  fetchContact,
  fetchContacts,
  fetchServerRecents,
  patchContact,
  removeContactAddress,
  setDefaultContactAddress,
  type NewContactInput,
  type ServerRecentRecipient,
} from "./api";
import {
  contactsForChain,
  findContactByAddress,
  searchContacts,
  type Contact,
} from "./model";

// ---------------------------------------------------------------------------
// Address-book state.
//
// ONE QUERY KEY, FILTERED LOCALLY. The API takes `?chain=` and `?q=`, and it
// would be easy to key a query on both — but that produces a cache entry per
// keystroke, refetches the whole book every time the user changes network, and
// leaves the send screen showing a spinner over a list it already has. The
// unfiltered book is small by construction (MAX_CONTACTS is 500, and a real
// book is a dozen rows), so it is fetched once and filtered in memory by the
// same pure functions the server uses. The chain/query parameters remain
// available in ./api for callers that genuinely want a server-side filter.
//
// MUTATIONS WRITE THE RESPONSE BACK. Every contacts endpoint returns the
// updated contact, so there is no reason to invalidate and refetch: the row is
// patched into the cached list directly and the screen updates without a
// network round trip. Invalidation still follows, so a change made on the web
// in the same second is picked up.
// ---------------------------------------------------------------------------

export const CONTACTS_KEY = ["contacts"] as const;

/** kv_cache key. Wiped by clearAllCaches() on both edges of a session, so a
 *  second account on a shared device can never be offered the first one's
 *  payees — the same reason lib/send/recipients.ts lives there. */
const CONTACTS_CACHE_KEY = "contacts";

export interface ContactsSnapshot {
  contacts: Contact[];
  /** True when the network was unreachable and this is the stored copy. */
  fromCache: boolean;
  /** When the snapshot was written. 0 when it is fresh from the server. */
  updatedAt: number;
}

/**
 * The whole address book, offline-first.
 *
 * WHY THIS IS CACHED AT ALL, having deliberately not been at first. The
 * argument against was real: a stale contact list can be MISSING the address
 * the user is about to pay, so serving one silently is a way to answer "is this
 * address someone I know?" with a confident and wrong no. The argument for is
 * stronger. An offline user was shown a bare error where the book they saved is
 * sitting on the device, and losing the book also loses the naming that turns a
 * hex string into a person on the review screen.
 *
 * WHAT MAKES IT SAFE IS THAT STALENESS IS CARRIED, NOT SWALLOWED. `fromCache`
 * and `updatedAt` come back with the data and the screens say so. Crucially,
 * `findContactByAddress` matching against a cached book can only ADD a name —
 * it can never suppress a warning, because the look-alike check runs off the
 * local payee history and the "first time sending here" suppression requires a
 * contact to be FOUND, not absent. A stale book that is missing an entry
 * therefore degrades to the more cautious behaviour, not the less.
 *
 * Writes remain refused offline (see the mutation callers): a queued contact
 * would show as saved while the server had never seen it.
 */
export function useContacts() {
  const query = useQuery({
    queryKey: CONTACTS_KEY,
    queryFn: async ({ signal }): Promise<ContactsSnapshot> => {
      try {
        const contacts = await fetchContacts({ signal });
        cacheSet(CONTACTS_CACHE_KEY, contacts);
        return { contacts, fromCache: false, updatedAt: Date.now() };
      } catch (e) {
        // ONLY a transport failure falls back. A 401, a 500 or a malformed
        // response are not "you are offline", and serving a stored book for
        // them would hide a real fault behind stale data.
        if (e instanceof NetworkError) {
          const cached = cacheGet<Contact[]>(CONTACTS_CACHE_KEY);
          if (cached && Array.isArray(cached.value)) {
            return { contacts: cached.value, fromCache: true, updatedAt: cached.updatedAt };
          }
        }
        throw e;
      }
    },
    staleTime: 30_000,
  });

  return {
    contacts: query.data?.contacts ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    /** Distinguishes "no contacts yet" from "we could not load them". */
    error: query.error as Error | null,
    refetch: query.refetch,
    /** False until the first load resolves — an empty list before that is
     *  unknown, not empty, and the empty state must not claim otherwise. */
    loaded: query.data !== undefined,
    /** True when this is the stored copy rather than a fresh read. Screens that
     *  show it MUST say so; silently presenting stale data as current is the
     *  one thing this cache must never do. */
    fromCache: query.data?.fromCache ?? false,
    /** When the stored copy was written, for "saved copy from 2h ago". */
    updatedAt: query.data?.updatedAt ?? 0,
  };
}

/** One contact, seeded from the list so opening a row is instant. */
export function useContact(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["contacts", id],
    queryFn: () => fetchContact(id as string),
    enabled: !!id,
    initialData: () =>
      qc.getQueryData<ContactsSnapshot>(CONTACTS_KEY)?.contacts.find((c) => c.id === id),
    staleTime: 30_000,
  });
}

/**
 * The book filtered to what can actually be paid on `chain`, searched by
 * `query`. Both filters are the server's own functions, so a locally filtered
 * list and a server-filtered one can never disagree.
 *
 * `chain` undefined means "no source chosen yet" and returns the whole book —
 * the send screen is legitimately in that state before an asset is picked, and
 * hiding every contact there reads as an empty address book.
 */
export function useContactsForChain(chain: Chain | undefined, query = "") {
  const { contacts, ...rest } = useContacts();
  const filtered = useMemo(() => {
    const scoped = chain ? contactsForChain(contacts, chain) : contacts;
    return searchContacts(scoped, query);
  }, [contacts, chain, query]);
  return { contacts: filtered, ...rest };
}

/**
 * Payees this ACCOUNT has paid, from the server — as opposed to
 * lib/send/recipients.ts, which is what THIS DEVICE has paid.
 *
 * The two are complements, not rivals, and the local one is not going away:
 * it is what look-alike detection compares against and it has to keep working
 * offline. This adds the payees made on the web app or another phone, which the
 * local list can never know about.
 *
 * `durable: false` is the field that matters. It means the payments table is
 * not present on this deployment, so there is no history to read — which is NOT
 * "you have paid nobody". A screen that renders an empty state for it is
 * asserting something the server explicitly declined to assert, so the flag is
 * returned rather than folded into an empty array.
 *
 * Failure is soft: this is a convenience list beside a working local one, so a
 * dead endpoint returns nothing and shows nothing rather than erroring a screen
 * the user is trying to pay from.
 */
export function useServerRecents(chain: Chain | undefined) {
  const query = useQuery({
    queryKey: ["contacts", "recent", chain ?? "all"],
    queryFn: ({ signal }) => fetchServerRecents(chain, signal),
    staleTime: 60_000,
    retry: false,
  });
  return {
    recents: (query.data?.recents ?? []) as ServerRecentRecipient[],
    /** False when this deployment keeps no payment history at all. */
    durable: query.data?.durable ?? true,
    /** True once an answer has arrived — an empty list before that is unknown. */
    loaded: query.data !== undefined,
    isLoading: query.isLoading,
  };
}

/**
 * The contact that owns this address, if any — what turns a hex string into a
 * name on the review screen.
 */
export function useContactForAddress(address: string, chain: Chain | undefined) {
  const { contacts } = useContacts();
  return useMemo(() => {
    if (!chain || !address.trim()) return undefined;
    return findContactByAddress(contacts, address, chain);
  }, [contacts, address, chain]);
}

/**
 * Turn a server error into something a user can act on.
 *
 * The contacts routes return a machine-readable `error` plus a written
 * `message`; preferring the message means the user reads "You already have a
 * contact with that name" rather than "name_taken", and the fallback covers a
 * deployment whose route predates the message field.
 */
export function contactErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const data = e.data as { message?: string; error?: string } | null;
    if (data?.message) return data.message;
    switch (data?.error) {
      case "name_taken":
        return "You already have a contact with that name.";
      case "contact_limit_reached":
        return "You have reached the contact limit.";
      case "address_limit_reached":
        return "This contact already holds the maximum number of addresses.";
      case "duplicate_address":
        return "That address is already saved to this contact.";
      case "invalid_address":
        return "That address is not valid on the selected network.";
      case "not_found":
        return "That contact no longer exists.";
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * Every write against the address book, sharing one cache-update path.
 *
 * Each mutation returns the updated contact, so `upsert` patches it into the
 * cached list and the UI is correct before the follow-up invalidation lands.
 * A create is appended; a delete removes the row.
 */
export function useContactMutations() {
  const qc = useQueryClient();

  /**
   * Patch one contact into the cached snapshot AND the stored copy.
   *
   * Both, deliberately. Writing only the query cache would mean a contact added
   * on this device vanished from the offline book the moment the app restarted,
   * which reads exactly like the save failed.
   *
   * `fromCache` is forced back to false: this snapshot now contains a change
   * the server has confirmed, so presenting it as a stale copy would be the
   * opposite of the lie the flag exists to prevent.
   */
  const writeSnapshot = useCallback(
    (mutate: (prev: Contact[]) => Contact[]) => {
      qc.setQueryData<ContactsSnapshot>(CONTACTS_KEY, (prev) => {
        const contacts = mutate(prev?.contacts ?? []);
        try {
          cacheSet(CONTACTS_CACHE_KEY, contacts);
        } catch {
          // A failed durable write costs the offline copy its freshness, never
          // the change itself — the server already accepted it.
        }
        return { contacts, fromCache: false, updatedAt: Date.now() };
      });
    },
    [qc]
  );

  const upsert = useCallback(
    (contact: Contact) => {
      writeSnapshot((prev) => {
        const index = prev.findIndex((c) => c.id === contact.id);
        if (index === -1) return [...prev, contact];
        const next = [...prev];
        next[index] = contact;
        return next;
      });
      qc.setQueryData(["contacts", contact.id], contact);
    },
    [qc, writeSnapshot]
  );

  const forget = useCallback(
    (id: string) => {
      writeSnapshot((prev) => prev.filter((c) => c.id !== id));
      qc.removeQueries({ queryKey: ["contacts", id] });
    },
    [qc, writeSnapshot]
  );

  const create = useMutation({
    mutationFn: (input: NewContactInput) => createContact(input),
    onSuccess: upsert,
  });

  const update = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof patchContact>[1];
    }) => patchContact(id, patch),
    onSuccess: upsert,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteContact(id).then(() => id),
    onSuccess: forget,
  });

  const addAddress = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: { address: string; chain: Chain; label?: string };
    }) => addContactAddress(id, input),
    onSuccess: upsert,
  });

  const removeAddress = useMutation({
    mutationFn: ({ id, addressId }: { id: string; addressId: string }) =>
      removeContactAddress(id, addressId),
    onSuccess: upsert,
  });

  const setDefaultAddress = useMutation({
    mutationFn: ({ id, addressId }: { id: string; addressId: string }) =>
      setDefaultContactAddress(id, addressId),
    onSuccess: upsert,
  });

  return {
    create,
    update,
    remove,
    addAddress,
    removeAddress,
    setDefaultAddress,
    /** True while ANY write is in flight — what a screen disables its controls
     *  on, so two mutations cannot race on the same contact. */
    busy:
      create.isPending ||
      update.isPending ||
      remove.isPending ||
      addAddress.isPending ||
      removeAddress.isPending ||
      setDefaultAddress.isPending,
  };
}
