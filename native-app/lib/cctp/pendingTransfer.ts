import * as SecureStore from "expo-secure-store";
import { BACKGROUND_READABLE } from "../storageOptions";
import type { CctpChain } from "./cctpClient";

// ---------------------------------------------------------------------------
// The record that survives the app dying mid-transfer.
//
// A CCTP burn is IRREVERSIBLE and the mint is a separate transaction the user
// must still send. Between them sits an attestation wait — nominally seconds,
// but unbounded when Circle is slow or the source chain is congested. If the OS
// kills the app in that window and nothing was written down, the USDC is burned
// and this app no longer knows a transfer was ever in flight: there is no local
// record of the burn hash to resume from, and the user is left holding nothing
// with no way to claim it from our UI.
//
// So the record is written BEFORE the burn is broadcast, not after. A record
// for a transfer that never got sent is harmless — it resolves to "no such
// message" on the first poll and is cleared. The reverse is not recoverable.
// ---------------------------------------------------------------------------

/** One in-flight transfer. Small and flat: it is written on a hot path. */
export interface PendingCctpTransfer {
  /** Set once the burn is broadcast. Absent means "we were about to send". */
  burnTxHash?: string;
  sourceChain: CctpChain;
  destinationChain: CctpChain;
  sourceDomain: number;
  /** 6-decimal atomic string, as the server sent it. */
  amountAtomic: string;
  recipient: string;
  attestationPath: string;
  /** Epoch ms, for showing how long a wait has run and for expiry. */
  startedAt: number;
  /** Populated when the attestation completes, so the mint leg survives too. */
  message?: string;
  attestation?: string;
}

const KEY = "cctp_pending_transfer";

/**
 * How long a record stays worth resuming.
 *
 * Circle's attestations do not expire, so this is not a protocol deadline — it
 * bounds how long a stale record keeps prompting someone about a transfer they
 * have since completed elsewhere. Deliberately generous: a user who reopens the
 * app a day later with an unminted burn should still be offered the mint.
 */
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `BACKGROUND_READABLE` rather than `DEVICE_ONLY`.
 *
 * Justified at the call site as that module asks: resume logic runs from a
 * cold start that can land before the user unlocks, and a record that cannot be
 * read then is a record that does not do its job. It stays ThisDeviceOnly — the
 * relaxation is about WHEN, never about leaving the device. Nothing secret is
 * here in any case: a burn hash and an amount are both public on-chain the
 * moment the burn lands.
 */
const OPTS = BACKGROUND_READABLE;

export async function savePendingTransfer(t: PendingCctpTransfer): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(t), OPTS);
  } catch {
    // Never block a transfer on the bookkeeping. A failed write costs the
    // resume path; a thrown error here would cost the burn the user asked for.
  }
}

export async function loadPendingTransfer(): Promise<PendingCctpTransfer | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, OPTS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCctpTransfer;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.sourceDomain !== "number" || !parsed.amountAtomic) return null;
    if (Date.now() - parsed.startedAt > PENDING_TTL_MS) {
      await clearPendingTransfer();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingTransfer(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, OPTS);
  } catch {
    /* nothing actionable */
  }
}

/** Merge fields into the stored record, if one is still there. */
export async function updatePendingTransfer(
  patch: Partial<PendingCctpTransfer>
): Promise<PendingCctpTransfer | null> {
  const current = await loadPendingTransfer();
  if (!current) return null;
  const next = { ...current, ...patch };
  await savePendingTransfer(next);
  return next;
}

/**
 * Is this record worth resuming, and at which leg?
 *
 * Returns the step the UI should re-enter, so a resumed transfer rejoins the
 * same state machine a fresh one uses rather than getting a parallel path.
 */
export function resumeStageFor(
  t: PendingCctpTransfer
): "discard" | "await_attestation" | "ready_to_mint" {
  if (!t.burnTxHash) return "discard"; // never actually broadcast
  if (t.message && t.attestation) return "ready_to_mint";
  return "await_attestation";
}
