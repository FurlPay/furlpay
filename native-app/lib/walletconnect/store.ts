import { getDb } from "@/lib/db";
import type { WalletConnectSession } from "./types";

// ---------------------------------------------------------------------------
// The local record of which dApps hold a live grant.
//
// THIS IS A MIRROR, NOT THE SOURCE OF TRUTH. The relay and the WalletConnect
// SDK's own keychain own session existence; this table exists so the app can
// render "connected sites" instantly at launch, sorted and searchable, without
// waiting for a socket. Reconciliation runs the other way at startup — see
// `reconcile()`: anything the SDK does not confirm is dropped, never revived.
//
// The alternative (treating this table as authoritative) produces the worst
// possible bug in a wallet: a session shown as revoked that the relay still
// honours, so the user believes they have disconnected a site that can still
// prompt them to sign.
// ---------------------------------------------------------------------------

interface Row {
  topic: string;
  pairing_topic: string;
  dapp_name: string;
  dapp_url: string;
  dapp_icon: string | null;
  verified_origin: string | null;
  verified_validation: string | null;
  accounts: string;
  chains: string;
  methods: string;
  events: string;
  expires_at: number;
  connected_at: number;
  last_activity_at: number;
}

function toSession(r: Row): WalletConnectSession {
  return {
    topic: r.topic,
    pairingTopic: r.pairing_topic,
    dapp: {
      name: r.dapp_name,
      description: "",
      url: r.dapp_url,
      icons: r.dapp_icon ? [r.dapp_icon] : [],
      verified: r.verified_origin
        ? {
            origin: r.verified_origin,
            validation: (r.verified_validation as "VALID" | "INVALID" | "UNKNOWN") ?? "UNKNOWN",
          }
        : undefined,
    },
    accounts: parseList(r.accounts),
    chains: parseList(r.chains),
    methods: parseList(r.methods),
    events: parseList(r.events),
    expiresAt: r.expires_at,
    connectedAt: r.connected_at,
    lastActivityAt: r.last_activity_at,
  };
}

/**
 * Stored as JSON arrays. A corrupt value yields an EMPTY list, never a throw:
 * one unparseable row must not take down the sessions screen, and an empty
 * permission list is the safe reading — it grants nothing.
 */
function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveSession(session: WalletConnectSession): void {
  getDb().runSync(
    `INSERT OR REPLACE INTO wc_sessions
       (topic, pairing_topic, dapp_name, dapp_url, dapp_icon, verified_origin, verified_validation,
        accounts, chains, methods, events, expires_at, connected_at, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    session.topic,
    session.pairingTopic,
    session.dapp.name,
    session.dapp.url,
    session.dapp.icons[0] ?? null,
    session.dapp.verified?.origin ?? null,
    session.dapp.verified?.validation ?? null,
    JSON.stringify(session.accounts),
    JSON.stringify(session.chains),
    JSON.stringify(session.methods),
    JSON.stringify(session.events),
    session.expiresAt,
    session.connectedAt,
    session.lastActivityAt,
  );
}

export function listSessions(now: number = Date.now()): WalletConnectSession[] {
  // Expired rows are filtered in the QUERY rather than swept on a timer. A
  // sweep that has not run yet would render an expired session as live, and the
  // user would tap "disconnect" on something already gone.
  const rows = getDb().getAllSync<Row>(
    "SELECT * FROM wc_sessions WHERE expires_at > ? ORDER BY last_activity_at DESC",
    now,
  );
  return rows.map(toSession);
}

export function getSession(topic: string): WalletConnectSession | null {
  const row = getDb().getFirstSync<Row>("SELECT * FROM wc_sessions WHERE topic = ?", topic);
  return row ? toSession(row) : null;
}

export function touchSession(topic: string, at: number = Date.now()): void {
  getDb().runSync("UPDATE wc_sessions SET last_activity_at = ? WHERE topic = ?", at, topic);
}

export function removeSession(topic: string): void {
  getDb().runSync("DELETE FROM wc_sessions WHERE topic = ?", topic);
}

export function removeAllSessions(): void {
  getDb().runSync("DELETE FROM wc_sessions");
}

/** Delete rows past their deadline. Returns the topics dropped, for analytics. */
export function pruneExpired(now: number = Date.now()): string[] {
  const rows = getDb().getAllSync<{ topic: string }>("SELECT topic FROM wc_sessions WHERE expires_at <= ?", now);
  if (rows.length > 0) getDb().runSync("DELETE FROM wc_sessions WHERE expires_at <= ?", now);
  return rows.map((r) => r.topic);
}

/**
 * Make the mirror match what the SDK actually holds.
 *
 * ONE-DIRECTIONAL BY DESIGN: rows the SDK does not list are deleted, and rows
 * the SDK has that we do not are inserted from the SDK's copy. We never push a
 * local row back into the SDK — a session this table remembers and the relay
 * has forgotten is not a session, and resurrecting it would mean showing the
 * user a grant that cannot be revoked because it does not exist.
 *
 * Returns the topics that were dropped so the caller can tell the user why a
 * site vanished from their list.
 */
export function reconcile(live: WalletConnectSession[]): { dropped: string[]; added: string[] } {
  const liveTopics = new Set(live.map((s) => s.topic));
  const stored = getDb().getAllSync<{ topic: string }>("SELECT topic FROM wc_sessions");

  const dropped: string[] = [];
  for (const { topic } of stored) {
    if (!liveTopics.has(topic)) {
      removeSession(topic);
      dropped.push(topic);
    }
  }

  const storedTopics = new Set(stored.map((r) => r.topic));
  const added: string[] = [];
  for (const session of live) {
    if (!storedTopics.has(session.topic)) added.push(session.topic);
    // Written unconditionally: a session the SDK has renewed carries a later
    // expiry, and a stale local expiry would hide a live session from the list.
    saveSession(session);
  }

  return { dropped, added };
}
