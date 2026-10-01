import { createHash } from "crypto";
import { sbCount, sbInsertIgnoreDuplicates, sbRpc, supabaseBackend } from "@/lib/supabase";
import { validateClientEvent, type Rejection, type ValidClientEvent } from "./contract";

// ---------------------------------------------------------------------------
// Client analytics ingestion (POST /api/analytics/events[/batch]).
//
// The ONLY path by which a web page, the extension or the mobile apps write
// analytics: clients never hold database, Redis or AWS credentials.
//
//   identity   user_id = the authenticated session subject, or none. The
//              payload cannot name a user (contract.ts rejects it).
//   idempotent event_id = "c:" + sha256(identity | client event id), stored with
//              ignore-duplicates: a mobile retry of the same event is one row,
//              and a client cannot pre-empt ANOTHER identity's event ids.
//   ownership  a transactionId is kept only if the ops ledger says that
//              transaction belongs to the caller; otherwise the event is refused.
//   honest     storage failure is an error (503, client retries later), never
//              a 2xx "accepted". With no durable store configured (development)
//              the response says stored: false.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IngestIdentity {
  userId: string | null;
}

export interface IngestResult {
  accepted: number;
  rejected: { index: number; reason: Rejection | "unsupported_identity" | "transaction_not_owned" | "anonymous_transaction" }[];
  stored: boolean;
}

export class IngestStorageError extends Error {}

export function storedEventId(identity: IngestIdentity, ev: Pick<ValidClientEvent, "eventId" | "anonId" | "installationId">): string {
  const who = identity.userId ?? `anon:${ev.anonId ?? ev.installationId ?? "none"}`;
  return `c:${createHash("sha256").update(`${who}|${ev.eventId}`).digest("hex").slice(0, 48)}`;
}

async function ownsTransaction(userId: string, txId: string): Promise<boolean> {
  if (supabaseBackend !== "supabase") return false; // cannot verify → not accepted
  const n = await sbCount("ops_tx_events", `select=id&id=eq.${encodeURIComponent(txId)}&user_id=eq.${encodeURIComponent(userId)}`);
  return n > 0;
}

export async function ingestClientEvents(raw: unknown[], identity: IngestIdentity, now = Date.now()): Promise<IngestResult> {
  const result: IngestResult = { accepted: 0, rejected: [], stored: supabaseBackend === "supabase" };
  if (identity.userId !== null && !UUID.test(identity.userId)) {
    // The column is a uuid; storing such a subject as anonymous would misattribute.
    return { ...result, rejected: raw.map((_, index) => ({ index, reason: "unsupported_identity" as const })) };
  }
  const rows: Record<string, unknown>[] = [];
  const devices = new Map<string, ValidClientEvent>();
  const ownership = new Map<string, Promise<boolean>>();

  for (let index = 0; index < raw.length; index++) {
    const v = validateClientEvent(raw[index], now);
    if (!v.ok) {
      result.rejected.push({ index, reason: v.reason });
      continue;
    }
    const ev = v.event;
    if (ev.transactionId) {
      if (!identity.userId) {
        result.rejected.push({ index, reason: "anonymous_transaction" });
        continue;
      }
      if (!ownership.has(ev.transactionId)) ownership.set(ev.transactionId, ownsTransaction(identity.userId, ev.transactionId).catch(() => false));
      if (!(await ownership.get(ev.transactionId))) {
        result.rejected.push({ index, reason: "transaction_not_owned" });
        continue;
      }
    }
    rows.push({
      event_id: storedEventId(identity, ev),
      event_name: ev.eventName,
      user_id: identity.userId,
      actor_type: identity.userId ? "user" : "anonymous",
      source: "client",
      platform: ev.platform,
      schema_version: ev.schemaVersion,
      app_version: ev.appVersion,
      build_number: ev.buildNumber,
      os_version: ev.osVersion,
      // Signed in: the anonymous id is dropped, so pre- and post-login traffic
      // are never stitched together by this table.
      anon_id: identity.userId ? null : ev.anonId,
      session_id: ev.sessionId,
      installation_id: ev.installationId,
      route: ev.route,
      screen: ev.screen,
      transaction_ref: ev.transactionId,
      metadata: ev.metadata,
      client_ts: ev.clientTs,
      created_at: new Date(now).toISOString(),
    });
    if (identity.userId && ev.installationId && ev.platform !== "web") devices.set(ev.installationId, ev);
  }

  result.accepted = rows.length;
  if (!rows.length || supabaseBackend !== "supabase") return result;

  try {
    await sbInsertIgnoreDuplicates("analytics_events", rows, AbortSignal.timeout(4_000));
  } catch (e) {
    throw new IngestStorageError((e as Error).message.slice(0, 160));
  }
  // Device bookkeeping is secondary: a failure here does not fail the batch.
  await Promise.all(
    [...devices.values()].map((ev) =>
      sbRpc("analytics_touch_device", {
        p_installation: ev.installationId,
        p_user: identity.userId,
        p_platform: ev.platform,
        p_version: ev.appVersion,
        p_build: ev.buildNumber,
      }).catch(() => false)
    )
  );
  return result;
}
