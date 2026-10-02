import { normalizeHandle, getHandle } from "@/lib/walletHandles";
import { sbRpc, supabaseBackend, SupabaseFunctionMissing } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Account usernames (migration 0029).
//
// RULES are the wallet-handle rules (lib/walletHandles.ts normalizeHandle):
// trimmed, lowercased, 3-32 characters of [a-z0-9-], no leading/trailing
// hyphen, not on the reserved list. One policy, so a username and a wallet
// handle can never disagree about what a name is.
//
// NOT A PAYMENT ROUTE. @handle payments resolve wallet handles only. To stop
// one person's username impersonating another person's wallet handle, a name
// held as a wallet handle by SOMEONE ELSE is refused as taken.
//
// WRITES are atomic and identity-bound: set_username(session user id, name).
// The unique index on users.username decides races; the general account save
// never writes the column (lib/storeDb.ts userToRow).
//
// Without Supabase (local development) a process-local map stands in for the
// unique index. It is never used when a durable store is configured.
// ---------------------------------------------------------------------------

export type UsernameResult =
  | { ok: true; username: string | null }
  | { ok: false; reason: "invalid"; detail: string }
  | { ok: false; reason: "taken"; detail: string }
  | { ok: false; reason: "unavailable"; detail: string };

const g = globalThis as unknown as { __furlpayDevUsernames?: Map<string, string> };
const devIndex = () => (g.__furlpayDevUsernames ??= new Map<string, string>()); // username -> userId

/** Validate and normalize. The wallet-handle wording is adapted for usernames. */
export function validateUsername(raw: unknown): { ok: true; username: string } | { ok: false; detail: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, detail: "Enter a username." };
  const v = normalizeHandle(raw.trim().replace(/^@/, ""));
  if (!v.ok || !v.normalized) {
    return { ok: false, detail: v.error === "That name is reserved." ? "That username is reserved." : v.error ?? "Invalid username." };
  }
  return { ok: true, username: v.normalized };
}

/**
 * Set (or, with null, clear) `userId`'s username. `userId` MUST be the session
 * subject; the route never takes it from the request body.
 */
export async function setAccountUsername(
  account: { user: { id: string; username?: string } },
  raw: string | null
): Promise<UsernameResult> {
  const userId = account.user.id;
  let username: string | null = null;
  if (raw !== null) {
    const v = validateUsername(raw);
    if (!v.ok) return { ok: false, reason: "invalid", detail: v.detail };
    username = v.username;
    if (username === account.user.username) return { ok: true, username };

    // Someone else's wallet handle is not available as a username.
    let owner: Awaited<ReturnType<typeof getHandle>> = null;
    try {
      owner = await getHandle(username);
    } catch {
      return { ok: false, reason: "unavailable", detail: "Could not check that name right now. Try again." };
    }
    if (owner?.ownerId && owner.ownerId !== userId) {
      return { ok: false, reason: "taken", detail: "That username is taken." };
    }
  }

  if (supabaseBackend === "supabase") {
    let outcome: string;
    try {
      outcome = await sbRpc<string>("set_username", { p_user: userId, p_username: username });
    } catch (e) {
      if (e instanceof SupabaseFunctionMissing) {
        return { ok: false, reason: "unavailable", detail: "Usernames are not enabled on this deployment yet." };
      }
      return { ok: false, reason: "unavailable", detail: "Could not save your username. Try again." };
    }
    if (outcome === "taken") return { ok: false, reason: "taken", detail: "That username is taken." };
    if (outcome === "invalid") return { ok: false, reason: "invalid", detail: "That username is not allowed." };
    if (outcome !== "ok") return { ok: false, reason: "unavailable", detail: "Could not save your username. Try again." };
  } else {
    const index = devIndex();
    if (username) {
      const holder = index.get(username);
      if (holder && holder !== userId) return { ok: false, reason: "taken", detail: "That username is taken." };
    }
    if (account.user.username) index.delete(account.user.username);
    if (username) index.set(username, userId);
  }

  // Keep this instance's cached account in step with what was stored.
  if (username) account.user.username = username;
  else delete account.user.username;
  return { ok: true, username };
}
