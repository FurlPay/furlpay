"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJSON, sendJSON } from "@/lib/api";
import { clearOfflineData } from "@/lib/offline";
import { PageHeader, Pill, Spinner, timeAgo } from "@/components/ui";

interface Device { name: string; location: string; lastActive: string; current: boolean }
interface Profile {
  name: string;
  email: string;
  /** Provider-hosted photo, when one is known. */
  avatarUrl: string | null;
  /** Up to two letters from the real name; null when there is no name. */
  initials: string | null;
  safeAddress: string;
  kycStatus: "verified" | "pending" | "unverified";
  region: string;
  tier: "Standard" | "Pro" | "Ultra";
  security: {
    biometricEnabled: boolean;
    accountLocked: boolean;
    lastLogin: string;
    loginAlerts: boolean;
    totpEnabled: boolean;
    hardwareKeys: { name: string; addedAt: string }[];
    devices: Device[];
  };
  notifications: { transactions: boolean; security: boolean; priceAlerts: boolean; product: boolean };
}

/** What deletion keeps, straight from the server — never hardcoded here, so the
 *  copy the user reads cannot drift from the retention model the API applies. */
interface Retained { record: string; reason: string }
interface DeletionPreview { stepUpSatisfied: boolean; retained: Retained[] }

export default function ProfilePage() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Display-name editing. `PATCH /api/profile` has always accepted and
  // validated a name; nothing ever sent one, so the capability was unreachable.
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const load = useCallback(() => {
    getJSON<Profile>("/api/profile").then(setP).catch(console.error);
  }, []);
  useEffect(() => load(), [load]);

  async function patch(body: Record<string, unknown>) {
    await sendJSON("/api/profile", body, "PATCH");
    load();
  }

  async function logout() {
    // Wipe offline account data (IndexedDB + cached page HTML) with the session.
    await clearOfflineData();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  /** The account is gone server-side; scrub every local trace before leaving. */
  async function afterDeletion() {
    await clearOfflineData();
    router.push("/login?deleted=1");
  }

  if (!p) return <Spinner />;

  const kycTone: "gain" | "accent" | "loss" =
    p.kycStatus === "verified" ? "gain" : p.kycStatus === "pending" ? "accent" : "loss";

  return (
    <>
      <PageHeader title="Profile" right={<Pill tone="accent">{p.tier}</Pill>} />

      {/* Identity header */}
      <section className="px-5">
        <div className="flex items-center gap-4">
          {/* The SAME avatar the header shows. This used to be
              `p.name.charAt(0)` on a flat red circle, so a user signed in with
              Google saw their photo in the top bar and a single letter here. */}
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06]">
            {p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a remote
              // provider URL; next/image would need it in remotePatterns and
              // buys nothing for a 64px square that is already cached.
              <img
                src={p.avatarUrl}
                alt=""
                width={64}
                height={64}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : p.initials ? (
              <span className="text-xl font-bold text-textPrimary">{p.initials}</span>
            ) : (
              <span className="text-xl font-bold text-textSecondary" aria-hidden>·</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSavingName(true);
                  setNameError(null);
                  try {
                    await sendJSON("/api/profile", { name: draftName.trim() }, "PATCH");
                    setEditingName(false);
                    load();
                  } catch (err) {
                    // The server's own message: it validates length and
                    // character set, and its wording is more useful than a
                    // generic "could not save".
                    setNameError(err instanceof Error ? err.message : "Could not save your name.");
                  } finally {
                    setSavingName(false);
                  }
                }}
                className="flex flex-col gap-2"
              >
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={50}
                  aria-label="Display name"
                  className="w-full rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-[15px] font-semibold outline-none focus:border-accent/50"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={savingName || draftName.trim().length === 0}
                    className="tap rounded-pill bg-accent px-4 py-1.5 text-[13px] font-semibold disabled:opacity-50"
                  >
                    {savingName ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingName(false);
                      setNameError(null);
                    }}
                    className="tap rounded-pill border border-white/[0.12] px-4 py-1.5 text-[13px] font-semibold text-textSecondary"
                  >
                    Cancel
                  </button>
                </div>
                {nameError && (
                  <p role="alert" className="text-[12px] text-loss">
                    {nameError}
                  </p>
                )}
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <p className="truncate text-xl font-bold">{p.name}</p>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(p.name);
                    setEditingName(true);
                  }}
                  aria-label="Edit display name"
                  className="tap shrink-0 rounded-lg px-2 py-1 text-[12px] font-semibold text-accent hover:bg-white/[0.06]"
                >
                  Edit
                </button>
              </div>
            )}
            <p className="truncate text-[13px] text-textSecondary">{p.email}</p>
            <p className="mt-0.5 font-mono text-[11px] text-textMuted">{p.safeAddress} · {p.region}</p>
          </div>
        </div>
      </section>

      {/* KYC / verification */}
      <Group title="Identity">
        <Row label="KYC status" right={<Pill tone={kycTone}>{p.kycStatus}</Pill>} />
        {p.kycStatus !== "verified" && (
          <button onClick={() => router.push("/signup")} className="w-full px-4 py-3 text-left text-[14px] text-accent">
            Verify your account →
          </button>
        )}
        <Row label="Plan tier" right={<Pill tone="accent">{p.tier}</Pill>} />
      </Group>

      {/* Security center */}
      <Group title="Security center">
        <Toggle label="Biometric unlock (Face ID)" on={p.security.biometricEnabled}
          onClick={() => patch({ security: { biometricEnabled: !p.security.biometricEnabled } })} />
        <Toggle label="Login & activity alerts" on={p.security.loginAlerts}
          onClick={() => patch({ security: { loginAlerts: !p.security.loginAlerts } })} />
        <Row label="Authenticator app (TOTP)" right={
          <Pill tone={p.security.totpEnabled ? "gain" : "muted"}>{p.security.totpEnabled ? "Enabled" : "Off"}</Pill>
        } />
        <Row label="Hardware security keys" right={
          <span className="text-[13px] text-textSecondary">
            {p.security.hardwareKeys.length ? p.security.hardwareKeys.map((k) => k.name).join(", ") : "None"}
          </span>
        } />
        <Row label="Last login" right={<span className="text-[13px] text-textSecondary">{timeAgo(p.security.lastLogin)}</span>} />
        <button
          onClick={() => {
            if (!p.security.accountLocked) void patch({ action: "lock" });
          }}
          className={`w-full px-4 py-3 text-left text-[14px] font-semibold ${p.security.accountLocked ? "text-gain" : "text-loss"}`}
        >
          {p.security.accountLocked ? "Account locked" : "Lock account instantly"}
        </button>
      </Group>

      {/* Devices / sessions */}
      <Group title="Devices & sessions">
        {p.security.devices.map((d) => (
          <div key={d.name} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-[14px] font-medium">{d.name} {d.current && <span className="text-gain">· this device</span>}</p>
              <p className="text-[12px] text-textSecondary">{d.location} · {timeAgo(d.lastActive)}</p>
            </div>
            {!d.current && <button className="text-[13px] text-loss">Revoke</button>}
          </div>
        ))}
      </Group>

      {/* Notifications */}
      <Group title="Notifications">
        {(["transactions", "security", "priceAlerts", "product"] as const).map((k) => (
          <Toggle key={k} label={labelFor(k)} on={p.notifications[k]}
            onClick={() => patch({ notifications: { [k]: !p.notifications[k] } })} />
        ))}
      </Group>

      {/* General */}
      <Group title="General">
        <button onClick={logout} className="w-full px-4 py-3 text-left text-[14px] font-semibold">
          Log out
        </button>
        <button
          onClick={() => setDeleting(true)}
          className="w-full px-4 py-3 text-left text-[14px] font-semibold text-loss"
        >
          Delete account
        </button>
      </Group>

      {deleting && <DeleteAccount onCancel={() => setDeleting(false)} onDeleted={afterDeletion} />}

      <p className="px-5 pb-4 pt-2 text-center text-[11px] text-textMuted">Furlpay demo · v0.1.0</p>
    </>
  );
}

function labelFor(k: string) {
  return { transactions: "Transaction alerts", security: "Security alerts", priceAlerts: "Price alerts", product: "Product updates" }[k] ?? k;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 px-5">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-textSecondary">{title}</h2>
      <div className="overflow-hidden rounded-card bg-surface divide-y divide-white/5">{children}</div>
    </section>
  );
}

function Row({ label, right }: { label: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[14px]">{label}</span>
      {right}
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between px-4 py-3">
      <span className="text-[14px]">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/**
 * Real account deletion. Replaces the button that used to `confirm()` and then
 * merely log out — which told the user "this cannot be undone" while deleting
 * nothing.
 *
 * Three things this UI must get right:
 *  1. It must NOT claim total erasure. The retention list comes from the server
 *     (GET /api/account), so what the user reads is what the API actually does.
 *  2. Self-custodial wallet material lives in the user's own device/keystore —
 *     deleting the FurlPay account does not, and cannot, move their funds.
 *  3. A bare session is not enough (server enforces step-up); if this session
 *     hasn't re-authenticated recently, send the user to sign in again rather
 *     than firing a request we know will 403.
 */
function DeleteAccount({ onCancel, onDeleted }: { onCancel: () => void; onDeleted: () => Promise<void> }) {
  const router = useRouter();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJSON<DeletionPreview>("/api/account").then(setPreview).catch(() => setError("Could not load deletion details."));
  }, []);

  async function destroy() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account", { method: "DELETE" }).catch(() => null);
    if (!res) {
      setBusy(false);
      return setError("Network error — your account was not deleted.");
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      setBusy(false);
      return setError(
        body.error === "stepup_required"
          ? "For your security, sign in again and then delete within 10 minutes."
          : "This account cannot be deleted from a demo session."
      );
    }
    if (!res.ok) {
      setBusy(false);
      return setError("Deletion failed. Your account is unchanged — please try again.");
    }
    await onDeleted();
  }

  if (!preview) return null;

  const armed = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <section className="mt-6 px-5">
      <div className="rounded-card border border-loss/40 bg-surface p-4">
        <h2 className="text-[15px] font-bold text-loss">Delete your FurlPay account</h2>

        <p className="mt-3 text-[13px] font-semibold">This will be deleted</p>
        <p className="mt-1 text-[13px] text-textSecondary">
          Your profile and contact details, passkeys and linked sign-ins, balances, cards, bills,
          transaction history, trips, support conversations, agent keys, and push registrations.
          You will be signed out on every device and will not be able to sign in again.
        </p>

        <p className="mt-4 text-[13px] font-semibold">This will be kept</p>
        <ul className="mt-1 space-y-2">
          {preview.retained.map((r) => (
            <li key={r.record} className="text-[13px] text-textSecondary">
              <span className="font-medium text-textPrimary">{r.record}</span> — {r.reason}
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[13px] font-semibold">Your self-custodial wallet</p>
        <p className="mt-1 text-[13px] text-textSecondary">
          Your recovery phrase is held on your own device, not by FurlPay. Deleting your account
          does not move, return or destroy any on-chain funds, and we cannot recover the phrase for
          you afterwards. If you hold a balance in that wallet,{" "}
          <span className="font-medium text-textPrimary">back up your recovery phrase first</span>.
        </p>

        {!preview.stepUpSatisfied ? (
          <>
            <p className="mt-4 text-[13px] text-textSecondary">
              For your security, deleting an account requires a recent sign-in.
            </p>
            <button
              onClick={() => router.push("/login?next=/profile")}
              className="mt-3 w-full rounded-card bg-accent px-4 py-3 text-[14px] font-semibold text-black"
            >
              Sign in again to continue
            </button>
          </>
        ) : (
          <>
            <label className="mt-4 block text-[13px] text-textSecondary" htmlFor="confirm-delete">
              Type <span className="font-mono font-semibold text-textPrimary">DELETE</span> to confirm.
            </label>
            <input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              className="mt-2 w-full rounded-card bg-black/40 px-4 py-3 font-mono text-[14px] outline-none ring-1 ring-white/10 focus:ring-loss"
            />
            <button
              onClick={destroy}
              disabled={!armed || busy}
              className="mt-3 w-full rounded-card bg-loss px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Permanently delete my account"}
            </button>
          </>
        )}

        {error && <p className="mt-3 text-[13px] text-loss">{error}</p>}

        <button onClick={onCancel} className="mt-2 w-full px-4 py-3 text-[14px] text-textSecondary">
          Cancel
        </button>
      </div>
    </section>
  );
}
