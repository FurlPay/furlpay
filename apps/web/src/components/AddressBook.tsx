"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Star, Trash2, Check, ShieldCheck, X } from "lucide-react";
import { getJSON } from "@/lib/api";
import { classifyAddress, shortenAddress } from "@/lib/addressValidation";
import { AVATAR_COLORS, CHAINS, chainKind } from "@/lib/contactConstants";
import type { Contact, ContactAddress } from "@/lib/types";
import type { Chain } from "@furlpay/types";
import ContactAvatar from "./ContactAvatar";
import Modal from "./Modal";
import { Spinner } from "./ui";

// ---------------------------------------------------------------------------
// The address book screen.
//
// Every mutation here goes through the API, never through local state alone:
// the per-chain payability check that makes a contact trustworthy lives on the
// server (lib/contacts.ts), and an optimistic UI that shows an address as saved
// before the server has accepted it would be showing the user a contact that
// does not exist. So each action re-reads the contact the server returns.
// ---------------------------------------------------------------------------

/** POST/PATCH/DELETE that surfaces the server's message instead of throwing —
 *  every error this screen can hit (duplicate name, unpayable address, limit
 *  reached) is one the user can act on, so it has to be readable. */
async function mutate<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<{ ok: boolean; data: T & { message?: string; error?: string } }> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function AddressBook() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    getJSON<{ contacts: Contact[] }>("/api/contacts")
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
  }, []);
  useEffect(() => load(), [load]);

  /** Splice one server-returned contact back in, so a rename does not need a
   *  full reload and cannot briefly show stale data. */
  const replace = useCallback((updated: Contact) => {
    setContacts((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? (contacts ?? []).filter((c) => c.name.toLowerCase().includes(q)) : contacts ?? [];
    return [...list].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [contacts, query]);

  const open = visible.find((c) => c.id === openId) ?? contacts?.find((c) => c.id === openId) ?? null;

  async function toggleFavorite(contact: Contact) {
    const res = await mutate<{ contact: Contact }>(`/api/contacts/${contact.id}`, "PATCH", {
      isFavorite: !contact.isFavorite,
    });
    if (res.ok && res.data.contact) replace(res.data.contact);
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2 px-5">
        <div className="flex flex-1 items-center gap-2 rounded-2xl bg-surface px-3.5 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-textMuted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts"
            aria-label="Search contacts"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-textMuted"
          />
        </div>
        <button
          onClick={() => setCreating(true)}
          aria-label="Add contact"
          className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {contacts === null ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState hasContacts={(contacts?.length ?? 0) > 0} onAdd={() => setCreating(true)} />
      ) : (
        <ul className="space-y-1 px-3">
          {visible.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <button
                onClick={() => setOpenId(c.id)}
                className="tap flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-white/[0.04]"
              >
                <ContactAvatar name={c.name} color={c.avatarColor} favorite={c.isFavorite} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{c.name}</span>
                  <span className="block truncate text-[12px] text-textMuted">
                    {c.addresses.length === 0
                      ? "No addresses yet"
                      : c.addresses.length === 1
                        ? `${shortenAddress(c.addresses[0].address, 8, 6)} · ${c.addresses[0].chain}`
                        : `${c.addresses.length} addresses`}
                  </span>
                </span>
              </button>
              <button
                onClick={() => toggleFavorite(c)}
                aria-label={c.isFavorite ? `Unfavourite ${c.name}` : `Favourite ${c.name}`}
                aria-pressed={c.isFavorite}
                className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/[0.06]"
              >
                <Star
                  className={`h-4 w-4 ${c.isFavorite ? "fill-accent text-accent" : "text-textMuted"}`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      <CreateContactSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(contact) => {
          setContacts((prev) => [...(prev ?? []), contact]);
          setCreating(false);
          setOpenId(contact.id);
        }}
      />

      <ContactSheet
        contact={open}
        onClose={() => setOpenId(null)}
        onChanged={replace}
        onDeleted={(id) => {
          setContacts((prev) => (prev ?? []).filter((c) => c.id !== id));
          setOpenId(null);
        }}
      />
    </>
  );
}

function EmptyState({ hasContacts, onAdd }: { hasContacts: boolean; onAdd: () => void }) {
  return (
    <div className="px-8 py-16 text-center">
      <p className="text-[15px] font-semibold">
        {hasContacts ? "No contacts match that search." : "No saved contacts yet."}
      </p>
      {!hasContacts && (
        <>
          <p className="mx-auto mt-2 max-w-[280px] text-[13px] text-textSecondary">
            A contact is checked once and reused forever — FurlPay only saves an address it has
            confirmed is payable on the network you picked.
          </p>
          <button onClick={onAdd} className="tap mt-6 rounded-pill bg-accent px-6 py-3 text-[14px] font-semibold">
            Add your first contact
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function CreateContactSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (contact: Contact) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(AVATAR_COLORS[0]);
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<Chain>("base");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      // A different default colour each time, so a book of ten contacts is not
      // ten identical circles.
      setColor(AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
      setAddress("");
      setChain("base");
      setError(null);
    }
  }, [open]);

  const kind = classifyAddress(address);
  const addressOk = !address.trim() || kind === chainKind(chain);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await mutate<{ contact: Contact }>("/api/contacts", "POST", {
      name: name.trim(),
      avatarColor: color,
      ...(address.trim() ? { addresses: [{ address: address.trim(), chain }] } : {}),
    });
    setBusy(false);
    if (res.ok && res.data.contact) onCreated(res.data.contact);
    else setError(res.data.message ?? "Could not save that contact.");
  }

  return (
    <Modal open={open} onClose={onClose} title="New contact">
      <div className="flex items-center gap-3">
        <ContactAvatar name={name || "?"} color={color} size="lg" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          maxLength={64}
          autoFocus
          className="w-full rounded-2xl bg-surface px-4 py-3 text-[15px] font-semibold outline-none placeholder:text-textMuted"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={c === color}
            className="tap flex h-7 w-7 items-center justify-center rounded-full"
            style={{ background: c, boxShadow: c === color ? "0 0 0 2px #fff" : "none" }}
          >
            {c === color && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>

      <AddressFields
        address={address}
        chain={chain}
        onAddress={setAddress}
        onChain={setChain}
        valid={addressOk}
      />

      {error && <p className="mt-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</p>}

      <button
        onClick={submit}
        disabled={!name.trim() || !addressOk || busy}
        className="tap mt-4 w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save contact"}
      </button>
      <p className="mt-2 text-center text-[11px] text-textMuted">
        An address is only saved once we have confirmed it is payable on the network you chose.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Detail — rename, addresses, delete
// ---------------------------------------------------------------------------

function ContactSheet({
  contact,
  onClose,
  onChanged,
  onDeleted,
}: {
  contact: Contact | null;
  onClose: () => void;
  onChanged: (contact: Contact) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<Chain>("base");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(contact?.name ?? "");
    setAdding(false);
    setAddress("");
    setLabel("");
    setChain("base");
    setError(null);
    setConfirmDelete(false);
  }, [contact?.id, contact?.name]);

  if (!contact) return null;
  const id = contact.id;

  const kind = classifyAddress(address);
  const addressOk = kind === chainKind(chain);

  async function rename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === contact!.name) return;
    setError(null);
    const res = await mutate<{ contact: Contact }>(`/api/contacts/${id}`, "PATCH", { name: trimmed });
    if (res.ok && res.data.contact) onChanged(res.data.contact);
    else {
      setName(contact!.name);
      setError(res.data.message ?? "Could not rename that contact.");
    }
  }

  async function addAddress() {
    if (!addressOk || busy) return;
    setBusy(true);
    setError(null);
    const res = await mutate<{ contact: Contact }>(`/api/contacts/${id}/addresses`, "POST", {
      address: address.trim(),
      chain,
      ...(label.trim() ? { label: label.trim() } : {}),
    });
    setBusy(false);
    if (res.ok && res.data.contact) {
      onChanged(res.data.contact);
      setAdding(false);
      setAddress("");
      setLabel("");
    } else {
      setError(res.data.message ?? "Could not save that address.");
    }
  }

  async function removeAddress(addressId: string) {
    setError(null);
    const res = await mutate<{ contact: Contact }>(
      `/api/contacts/${id}/addresses/${addressId}`,
      "DELETE"
    );
    if (res.ok && res.data.contact) onChanged(res.data.contact);
    else setError(res.data.message ?? "Could not remove that address.");
  }

  async function makeDefault(addressId: string) {
    setError(null);
    const res = await mutate<{ contact: Contact }>(
      `/api/contacts/${id}/addresses/${addressId}`,
      "PATCH",
      { isDefault: true }
    );
    if (res.ok && res.data.contact) onChanged(res.data.contact);
    else setError(res.data.message ?? "Could not update that address.");
  }

  async function remove() {
    const res = await mutate(`/api/contacts/${id}`, "DELETE");
    if (res.ok) onDeleted(id);
    else setError("Could not delete that contact.");
  }

  return (
    <Modal open onClose={onClose} title="Contact">
      <div className="flex items-center gap-3">
        <ContactAvatar name={contact.name} color={contact.avatarColor} size="lg" favorite={contact.isFavorite} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          maxLength={64}
          aria-label="Contact name"
          className="w-full rounded-2xl bg-surface px-4 py-3 text-[15px] font-semibold outline-none"
        />
      </div>

      <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-textMuted">
        Addresses
      </p>

      {contact.addresses.length === 0 ? (
        <p className="rounded-2xl bg-white/[0.04] px-3 py-3 text-[13px] text-textSecondary">
          This contact has no addresses yet, so they cannot be paid.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {contact.addresses.map((a) => (
            <AddressRow
              key={a.id}
              address={a}
              onRemove={() => removeAddress(a.id)}
              onMakeDefault={() => makeDefault(a.id)}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <>
          <AddressFields
            address={address}
            chain={chain}
            onAddress={setAddress}
            onChain={setChain}
            valid={!address.trim() || addressOk}
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional) — e.g. cold wallet"
            maxLength={40}
            className="mt-2 w-full rounded-2xl bg-surface px-4 py-2.5 text-[13px] outline-none placeholder:text-textMuted"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setAdding(false)}
              className="tap flex-1 rounded-pill bg-white/[0.08] py-3 text-[14px] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={addAddress}
              disabled={!addressOk || busy}
              className="tap flex-1 rounded-pill bg-accent py-3 text-[14px] font-semibold disabled:opacity-40"
            >
              {busy ? "Checking…" : "Add address"}
            </button>
          </div>
        </>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="tap mt-3 flex w-full items-center justify-center gap-2 rounded-pill bg-white/[0.08] py-3 text-[14px] font-semibold"
        >
          <Plus className="h-4 w-4" /> Add an address
        </button>
      )}

      {error && <p className="mt-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</p>}

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="tap flex-1 rounded-pill bg-white/[0.08] py-3 text-[14px] font-semibold"
            >
              Keep
            </button>
            <button
              onClick={remove}
              className="tap flex-1 rounded-pill bg-loss py-3 text-[14px] font-semibold"
            >
              Delete {contact.name}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="tap flex items-center gap-2 text-[13px] font-semibold text-loss"
          >
            <Trash2 className="h-4 w-4" /> Delete contact
          </button>
        )}
      </div>
    </Modal>
  );
}

function AddressRow({
  address,
  onRemove,
  onMakeDefault,
}: {
  address: ContactAddress;
  onRemove: () => void;
  onMakeDefault: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-2xl bg-surface px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12px]">{shortenAddress(address.address, 12, 8)}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-textMuted">
          <span className="capitalize">{address.chain}</span>
          {address.label && <span>· {address.label}</span>}
          {address.isDefault && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gain/15 px-1.5 py-0.5 text-[10px] font-semibold text-gain">
              <ShieldCheck className="h-2.5 w-2.5" /> Default
            </span>
          )}
        </p>
      </div>
      {!address.isDefault && (
        <button
          onClick={onMakeDefault}
          className="tap shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-textSecondary"
        >
          Set default
        </button>
      )}
      <button
        onClick={onRemove}
        aria-label={`Remove ${address.address}`}
        className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-textMuted hover:bg-white/[0.06] hover:text-loss"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Address + chain, with the per-chain verdict shown as you type — the same
 *  check the server will run, so the user is never surprised at save. */
function AddressFields({
  address,
  chain,
  onAddress,
  onChain,
  valid,
}: {
  address: string;
  chain: Chain;
  onAddress: (v: string) => void;
  onChain: (c: Chain) => void;
  valid: boolean;
}) {
  const kind = classifyAddress(address);
  return (
    <div className="mt-4">
      <input
        value={address}
        onChange={(e) => onAddress(e.target.value.trim())}
        placeholder="0x… or Solana address"
        className="w-full rounded-2xl bg-surface px-4 py-3 font-mono text-[13px] outline-none placeholder:text-textMuted"
      />
      <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
        {CHAINS.map((c) => (
          <button
            key={c}
            onClick={() => onChain(c)}
            aria-pressed={c === chain}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold capitalize ${
              c === chain ? "bg-accent" : "bg-white/[0.06] text-textSecondary"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      {address.trim() && !valid && (
        <p className="mt-2 text-[12px] text-loss">
          {kind === null
            ? "That is not a valid wallet address."
            : `That is ${kind === "evm" ? "an EVM" : "a Solana"} address — it cannot receive on ${chain}.`}
        </p>
      )}
    </div>
  );
}
