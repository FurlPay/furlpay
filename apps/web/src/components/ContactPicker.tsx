"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { getJSON, HttpError } from "@/lib/api";
import { shortenAddress } from "@/lib/addressValidation";
import type { Contact, ContactAddress } from "@/lib/types";
import type { Chain } from "@furlpay/types";
import ContactAvatar from "./ContactAvatar";

// ---------------------------------------------------------------------------
// Choose who to pay, on a specific chain.
//
// Everything shown here is already known to be payable on `chain`: the server
// filters contacts and recents by chain family, and a typed name is resolved
// before it can be picked. That is the whole design goal — the picker must
// never hand its caller an address that fails at submit, because the moment it
// does the user goes back to pasting.
//
// Three sources, in confidence order:
//   1. saved contacts    — a name the user chose themselves
//   2. resolved input    — an address, ENS name or FurlPay name, checked live
//   3. recently paid     — from the payments ledger, not a guess
// ---------------------------------------------------------------------------

export interface PickedRecipient {
  address: string;
  chain: Chain;
  /** How the user should see this recipient once picked. */
  label: string;
  contactId?: string;
  avatarColor?: string;
}

interface RecentRecipient {
  address: string;
  chain: Chain;
  lastPaidAt: string;
  count: number;
  contact?: { id: string; name: string; avatarColor: string };
}

interface ResolveResponse {
  resolved: true;
  kind: "address" | "ens" | "furlpay";
  address: string;
  display: string;
  payableOnChain: boolean;
  contact?: { id: string; name: string; avatarColor: string };
}

type ResolveState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "resolved"; result: ResolveResponse }
  | { status: "none" }
  /** The lookup failed. Distinct from "none" on purpose: telling someone their
   *  friend's ENS name does not exist, when really the RPC was down, sends them
   *  straight back to pasting a raw address. */
  | { status: "unavailable" };

const RESOLVE_DEBOUNCE_MS = 350;

/**
 * Which address to pre-select for a contact.
 *
 * Deliberately NOT `defaultAddressForChain` from lib/contacts.ts — that module
 * pulls in `crypto` and `next/server` and has no business in a browser bundle.
 * It does not need to do the chain-family filtering either: `GET /api/contacts
 * ?chain=` has already stripped every address that is not payable here, so any
 * address still on the contact is a valid choice and the default is simply the
 * one flagged as such.
 */
function preferredAddress(contact: Contact): ContactAddress | undefined {
  return contact.addresses.find((a) => a.isDefault) ?? contact.addresses[0];
}

/**
 * Cheap pre-filter, so /api/contacts/resolve's 20/min budget is not spent on
 * every keystroke of a name search.
 *
 * Addresses and ENS names are unambiguous and always resolve. A bare word could
 * be either a FurlPay name or a search for a saved contact, so it is only
 * resolved when it matches no saved contact — searching for someone you have
 * already saved should never cost a network round trip.
 */
function looksResolvable(query: string, hasLocalMatch: boolean): boolean {
  const q = query.trim();
  if (q.length < 3) return false;
  if (q.startsWith("0x")) return true;
  if (q.toLowerCase().endsWith(".eth")) return true;
  // A base58-looking run long enough to be a Solana key.
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) return true;
  // FurlPay-name shaped (see normalizeHandle in lib/walletHandles.ts).
  return !hasLocalMatch && /^[a-zA-Z0-9-]{3,32}$/.test(q) && !q.startsWith("-") && !q.endsWith("-");
}

export default function ContactPicker({
  chain,
  onPick,
  onManage,
}: {
  chain: Chain;
  onPick: (picked: PickedRecipient) => void;
  /** Optional escape hatch to the full address book. */
  onManage?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [recents, setRecents] = useState<RecentRecipient[] | null>(null);
  const [recentsDurable, setRecentsDurable] = useState(true);
  const [resolve, setResolve] = useState<ResolveState>({ status: "idle" });

  // Contacts and recents are both chain-scoped, so a chain switch reloads both.
  useEffect(() => {
    const controller = new AbortController();
    getJSON<{ contacts: Contact[] }>(`/api/contacts?chain=${chain}`, { signal: controller.signal })
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
    getJSON<{ recents: RecentRecipient[]; durable: boolean }>(
      `/api/contacts/recent?chain=${chain}`,
      { signal: controller.signal }
    )
      .then((r) => {
        setRecents(r.recents);
        setRecentsDurable(r.durable);
      })
      .catch(() => setRecents([]));
    return () => controller.abort();
  }, [chain]);

  const visibleContacts = useMemo(() => {
    if (!contacts) return [];
    const q = query.trim().toLowerCase();
    return q ? contacts.filter((c) => c.name.toLowerCase().includes(q)) : contacts;
  }, [contacts, query]);

  // Live resolution of whatever is typed. Aborted and re-issued on each
  // keystroke so a slow ENS lookup can never overwrite a newer answer.
  const latest = useRef(0);
  const hasLocalMatch = visibleContacts.length > 0;
  useEffect(() => {
    if (!looksResolvable(query, hasLocalMatch)) {
      setResolve({ status: "idle" });
      return;
    }
    const seq = ++latest.current;
    const controller = new AbortController();
    setResolve({ status: "checking" });
    const timer = setTimeout(() => {
      getJSON<ResolveResponse>(
        `/api/contacts/resolve?name=${encodeURIComponent(query.trim())}&chain=${chain}`,
        { signal: controller.signal }
      )
        .then((result) => {
          if (seq === latest.current) setResolve({ status: "resolved", result });
        })
        .catch((err) => {
          if (seq !== latest.current) return;
          if (err instanceof HttpError && err.status === 404) setResolve({ status: "none" });
          else if (err instanceof HttpError && err.status === 400) setResolve({ status: "none" });
          else setResolve({ status: "unavailable" });
        });
    }, RESOLVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, chain, hasLocalMatch]);

  // A recent that is already a saved contact is shown once, as the contact.
  const visibleRecents = useMemo(() => (recents ?? []).filter((r) => !r.contact), [recents]);

  function pickContact(contact: Contact) {
    const address = preferredAddress(contact);
    if (!address) return;
    onPick({
      address: address.address,
      chain: address.chain,
      label: contact.name,
      contactId: contact.id,
      avatarColor: contact.avatarColor,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-2xl bg-surface px-3.5 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-textMuted" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, address, ENS or FurlPay name"
          aria-label="Search contacts or enter an address"
          className="w-full bg-transparent text-[14px] outline-none placeholder:text-textMuted"
        />
        {resolve.status === "checking" && (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-textMuted" aria-hidden />
        )}
      </div>

      {/* Whatever was typed, once we know what it is. */}
      {resolve.status === "resolved" && resolve.result.payableOnChain && (
        <button
          onClick={() =>
            onPick({
              address: resolve.result.address,
              chain,
              label: resolve.result.contact?.name ?? resolve.result.display,
              contactId: resolve.result.contact?.id,
              avatarColor: resolve.result.contact?.avatarColor,
            })
          }
          className="tap flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent/[0.08] px-3.5 py-3 text-left"
        >
          {resolve.result.contact ? (
            <ContactAvatar name={resolve.result.contact.name} color={resolve.result.contact.avatarColor} />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-bold uppercase">
              {resolve.result.kind === "ens" ? "ens" : resolve.result.kind === "furlpay" ? "fp" : "0x"}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold">
              {resolve.result.contact?.name ?? resolve.result.display}
            </span>
            <span className="block truncate font-mono text-[11px] text-textMuted">
              {shortenAddress(resolve.result.address, 10, 8)}
            </span>
          </span>
        </button>
      )}

      {resolve.status === "resolved" && !resolve.result.payableOnChain && (
        <Notice tone="warn">
          {resolve.result.display} resolves to an address that cannot receive on {chain}.
        </Notice>
      )}

      {resolve.status === "none" && query.trim().toLowerCase().endsWith(".eth") && (
        <Notice tone="muted">No address is set for that ENS name.</Notice>
      )}

      {resolve.status === "unavailable" && (
        <Notice tone="warn">
          We could not check that name right now — this is a lookup problem, not proof the name is
          wrong. Try again in a moment.
        </Notice>
      )}

      {/* Saved contacts */}
      {contacts === null ? (
        <p className="px-1 text-[13px] text-textMuted">Loading contacts…</p>
      ) : visibleContacts.length > 0 ? (
        <section>
          <SectionLabel>Contacts</SectionLabel>
          <ul className="space-y-1">
            {visibleContacts.map((c) => {
              const address = preferredAddress(c);
              return (
                <li key={c.id}>
                  <button
                    onClick={() => pickContact(c)}
                    disabled={!address}
                    className="tap flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-white/[0.04] disabled:opacity-40"
                  >
                    <ContactAvatar name={c.name} color={c.avatarColor} favorite={c.isFavorite} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold">{c.name}</span>
                      <span className="block truncate font-mono text-[11px] text-textMuted">
                        {address ? shortenAddress(address.address, 10, 6) : `Nothing payable on ${chain}`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : query.trim() ? null : (
        <p className="px-1 text-[13px] text-textMuted">
          No contacts on {chain} yet. Anyone you pay can be saved afterwards.
        </p>
      )}

      {/* Recently paid, from the ledger */}
      {visibleRecents.length > 0 && (
        <section>
          <SectionLabel>
            <Clock className="mr-1 inline h-3 w-3" aria-hidden /> Recently paid
          </SectionLabel>
          <ul className="space-y-1">
            {visibleRecents.map((r) => (
              <li key={`${r.chain}:${r.address}`}>
                <button
                  onClick={() =>
                    onPick({ address: r.address, chain: r.chain, label: shortenAddress(r.address, 6, 4) })
                  }
                  className="tap flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-white/[0.04]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
                    <Clock className="h-4 w-4 text-textMuted" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[13px]">
                      {shortenAddress(r.address, 10, 6)}
                    </span>
                    <span className="block text-[11px] text-textMuted">
                      Paid {r.count === 1 ? "once" : `${r.count} times`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!recentsDurable && (
        <p className="px-1 text-[11px] text-textMuted">
          Payment history is not available on this deployment, so recent recipients cannot be shown.
        </p>
      )}

      {onManage && (
        <button onClick={onManage} className="tap self-start text-[13px] font-semibold text-accent">
          Manage address book
        </button>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-textMuted">
      {children}
    </p>
  );
}

function Notice({ tone, children }: { tone: "warn" | "muted"; children: React.ReactNode }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-2xl px-3 py-2.5 text-[12px] ${
        tone === "warn" ? "bg-loss/10 text-loss" : "bg-white/[0.04] text-textSecondary"
      }`}
    >
      {tone === "warn" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}
