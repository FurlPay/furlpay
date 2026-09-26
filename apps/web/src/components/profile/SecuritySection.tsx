"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  NotWiredError,
  deletePasskey,
  disableMfa,
  enrollMfa,
  getBackupCodes,
  getPasskeys,
  patchProfile,
  verifyMfa,
  type PasskeyCredential,
  type Profile,
} from "@/lib/accountApi";
import { timeAgo } from "@/components/ui";
import ConfirmDialog from "./ConfirmDialog";
import {
  ActionButton,
  EmptyState,
  Feedback,
  NotWiredNote,
  Row,
  RowSkeleton,
  Section,
  StatusPill,
  Toggle,
} from "./primitives";

// ---------------------------------------------------------------------------
// Security.
//
// There is NO "change password" row here, and its absence is deliberate:
// FurlPay has no passwords. Sign-in is a passkey, a one-time email code, or
// Google/Apple — `User` carries no password hash and no auth route accepts one.
// A change-password form would be a control that cannot be wired to anything,
// so this section manages the credentials that actually exist instead.
//
// What is real: the passkey list and its revocation, TOTP enrollment and
// verification, the biometric and login-alert preferences, and the account
// lock. What is not: recovery codes, which need a hashed single-use store the
// MFA route does not have.
// ---------------------------------------------------------------------------

type Feed = { tone: "success" | "error"; text: string } | null;

export default function SecuritySection({
  profile,
  onChanged,
}: {
  profile: Profile;
  onChanged: () => void;
}) {
  const [passkeys, setPasskeys] = useState<PasskeyCredential[] | null>(null);
  const [passkeyError, setPasskeyError] = useState(false);
  const [feedback, setFeedback] = useState<Feed>(null);

  // 2FA enrollment: the secret is returned once, then exchanged for a code.
  const [enrolling, setEnrolling] = useState(false);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [confirmDisable, setConfirmDisable] = useState(false);
  // Proof required to turn MFA off — a TOTP code or a recovery code.
  const [disableCode, setDisableCode] = useState("");
  // Recovery codes, held only long enough for the user to save them. Never
  // persisted client-side: the server has hashes and cannot reissue these.
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [revoking, setRevoking] = useState<PasskeyCredential | null>(null);

  const loadPasskeys = useCallback(() => {
    getPasskeys()
      .then((r) => {
        setPasskeys(r.credentials);
        setPasskeyError(false);
      })
      .catch(() => {
        // Distinguish "none registered" from "could not ask" — the empty state
        // must not claim the user has no passkeys when the request failed.
        setPasskeys([]);
        setPasskeyError(true);
      });
  }, []);

  useEffect(loadPasskeys, [loadPasskeys]);

  async function beginEnroll() {
    setBusy(true);
    setDialogError(null);
    setFeedback(null);
    try {
      const r = await enrollMfa();
      setOtpauth(r.otpauthUrl);
      setEnrolling(true);
    } catch {
      setFeedback({ tone: "error", text: "Could not start two-factor setup. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    setBusy(true);
    setDialogError(null);
    try {
      const res = await verifyMfa(code.trim());
      setEnrolling(false);
      setCode("");
      setOtpauth(null);
      onChanged();
      // Shown ONCE — the server keeps only hashes and cannot reproduce them.
      // Held in state so the user can copy them before dismissing.
      setRecoveryCodes(res.recoveryCodes ?? []);
      setFeedback({ tone: "success", text: "Two-factor authentication is on." });
    } catch {
      // The route answers 401 for a wrong code; anything else is a transport
      // failure. Both leave the dialog open so the user can retry in place.
      setDialogError("That code was not accepted. Check your authenticator and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable2fa() {
    // The server now requires proof of the second factor, so the UI has to
    // collect it. Turning MFA off on a confirmation click alone meant a stolen
    // session could strip it.
    const proof = disableCode.trim();
    if (!proof) {
      setDialogError("Enter a code from your authenticator app, or one of your recovery codes.");
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      await disableMfa(proof);
      setConfirmDisable(false);
      setDisableCode("");
      onChanged();
      setFeedback({ tone: "success", text: "Two-factor authentication is off." });
    } catch {
      // 401 for a bad code, 400 for a missing one. Both are recoverable in place,
      // and the message must not say which factor failed.
      setDialogError("That code was not accepted. Try your authenticator app or a recovery code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevokePasskey() {
    if (!revoking) return;
    setBusy(true);
    setDialogError(null);
    try {
      await deletePasskey(revoking.id);
      setRevoking(null);
      loadPasskeys();
      setFeedback({ tone: "success", text: "Passkey removed." });
    } catch (err) {
      // Includes the server's own 409 for "this is your only passkey".
      setDialogError(err instanceof Error ? err.message : "Could not remove this passkey.");
    } finally {
      setBusy(false);
    }
  }

  async function onRecoveryCodes() {
    setFeedback(null);
    try {
      const { remaining } = await getBackupCodes();
      // Only a count is retrievable: the codes were shown once at enrolment and
      // the server holds hashes. Saying so is more useful than a dead end.
      setFeedback({
        tone: remaining > 0 ? "success" : "error",
        text:
          remaining > 0
            ? `${remaining} recovery code${remaining === 1 ? "" : "s"} left. They were shown once when you turned two-factor on — we keep only hashes, so we cannot show them again. Generate a new set if you have lost them.`
            : "You have no recovery codes left. Generate a new set so you are not locked out if you lose your authenticator app.",
      });
    } catch {
      setFeedback({ tone: "error", text: "Could not check your recovery codes. Try again." });
    }
  }

  async function toggle(patch: Record<string, unknown>, label: string) {
    setFeedback(null);
    try {
      await patchProfile(patch);
      onChanged();
    } catch {
      setFeedback({ tone: "error", text: `Could not update ${label}.` });
    }
  }

  const totp = profile.security.totpEnabled;

  return (
    <>
      <Section
        title="Security"
        description="FurlPay is passwordless — these are the credentials that get you in."
        id="security"
      >
        {/* ── Sign-in methods ─────────────────────────────────────────── */}
        <Row
          label="Sign-in method"
          hint={
            profile.security.lastLogin
              ? `Last signed in ${timeAgo(profile.security.lastLogin)}`
              : undefined
          }
        >
          <StatusPill tone="muted">Passkey · email code</StatusPill>
        </Row>

        {passkeys === null ? (
          <RowSkeleton rows={1} />
        ) : passkeys.length === 0 ? (
          <EmptyState>
            {passkeyError
              ? "Could not load your passkeys. Check your connection and reload."
              : "No passkeys registered on this account yet."}
          </EmptyState>
        ) : (
          passkeys.map((k) => (
            <Row
              key={k.id}
              label={
                <span className="flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-textSecondary" aria-hidden />
                  {k.name || "Passkey"}
                </span>
              }
              hint={
                k.lastUsedAt
                  ? `Last used ${timeAgo(k.lastUsedAt)}`
                  : k.createdAt
                    ? `Added ${timeAgo(k.createdAt)}`
                    : undefined
              }
            >
              <ActionButton
                variant="danger"
                onClick={() => {
                  setDialogError(null);
                  setRevoking(k);
                }}
                ariaLabel={`Remove passkey ${k.name || k.id}`}
              >
                Remove
              </ActionButton>
            </Row>
          ))
        )}

        {/* ── Two-factor ──────────────────────────────────────────────── */}
        <Row
          label="Two-factor authentication"
          hint="A 6-digit code from your authenticator app, on top of your sign-in."
        >
          <StatusPill tone={totp ? "gain" : "muted"}>{totp ? "Enabled" : "Disabled"}</StatusPill>
          {totp ? (
            <ActionButton
              variant="danger"
              onClick={() => {
                setDialogError(null);
                setConfirmDisable(true);
              }}
            >
              Turn off
            </ActionButton>
          ) : (
            <ActionButton variant="primary" disabled={busy} onClick={beginEnroll}>
              {busy ? "Starting…" : "Set up"}
            </ActionButton>
          )}
        </Row>

        <Row label="Recovery codes" hint="One-time codes for when you lose your authenticator.">
          <ActionButton onClick={onRecoveryCodes}>View codes</ActionButton>
        </Row>

        {/* ── Preferences that are genuinely stored ───────────────────── */}
        <Toggle
          label="Biometric unlock"
          hint="Face ID or fingerprint on your own device."
          checked={profile.security.biometricEnabled}
          onChange={(v) => toggle({ security: { biometricEnabled: v } }, "biometric unlock")}
        />
        <Toggle
          label="Login and activity alerts"
          hint="Tells you when a new device signs in."
          checked={profile.security.loginAlerts}
          onChange={(v) => toggle({ security: { loginAlerts: v } }, "login alerts")}
        />

        <Row
          label="Lock account"
          hint="Immediately blocks money movement. Support has to unlock it again."
        >
          {profile.security.accountLocked ? (
            <StatusPill tone="loss">Locked</StatusPill>
          ) : (
            <ActionButton variant="danger" onClick={() => toggle({ action: "lock" }, "the lock")}>
              Lock now
            </ActionButton>
          )}
        </Row>

        {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}

        <NotWiredNote>
          There is no password to change: FurlPay signs you in with a passkey, an emailed code, or
          Google/Apple. Recovery codes still need a server-side store before they can be issued.
        </NotWiredNote>
      </Section>

      {/* ── Dialogs ───────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={enrolling}
        title="Verify it's you"
        description={
          <>
            <p>
              Add FurlPay to your authenticator app, then enter the 6-digit code it shows to finish
              turning on two-factor authentication.
            </p>
            {otpauth && (
              <p className="mt-3 break-all rounded-lg bg-black/40 p-2.5 font-mono text-[11px] text-textMuted">
                {otpauth}
              </p>
            )}
          </>
        }
        confirmLabel="Turn on 2FA"
        confirmDisabled={code.trim().length < 6}
        busy={busy}
        error={dialogError}
        onConfirm={confirmEnroll}
        onCancel={() => {
          setEnrolling(false);
          setCode("");
          setOtpauth(null);
        }}
      >
        <label htmlFor="totp-code" className="block text-[12px] font-medium text-textSecondary">
          One-time code
        </label>
        <input
          id="totp-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          className="mt-1.5 w-full rounded-lg border border-white/[0.12] bg-black/40 px-3 py-2.5 text-center font-mono text-[18px] tracking-[0.3em] text-white outline-none focus-visible:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDisable}
        title="Turn off two-factor authentication?"
        description="Your account will be protected by your sign-in method alone. Enter a code to confirm it's you — this stops someone with access to your signed-in device from removing it."
        confirmLabel="Turn off"
        destructive
        confirmDisabled={disableCode.trim().length < 6}
        busy={busy}
        error={dialogError}
        onConfirm={confirmDisable2fa}
        onCancel={() => {
          setConfirmDisable(false);
          setDisableCode("");
        }}
      >
        <label htmlFor="disable-totp-code" className="block text-[12px] font-medium text-textSecondary">
          Authenticator or recovery code
        </label>
        <input
          id="disable-totp-code"
          value={disableCode}
          // Accepts both shapes, so no digits-only filter: a recovery code is
          // letters and a dash.
          onChange={(e) => setDisableCode(e.target.value.slice(0, 16))}
          autoComplete="one-time-code"
          placeholder="000000"
          className="mt-1.5 w-full rounded-lg border border-white/[0.12] bg-black/40 px-3 py-2.5 text-center font-mono text-[16px] tracking-[0.2em] text-white outline-none focus-visible:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </ConfirmDialog>

      {/* Recovery codes, shown once. Not a ConfirmDialog with a cancel path:
          dismissing is the only action, and the copy has to make clear these
          cannot be retrieved later. */}
      <ConfirmDialog
        open={recoveryCodes.length > 0}
        title="Save your recovery codes"
        description="Each code works once, if you lose your authenticator app. We store only hashes, so this is the only time we can show them — save them somewhere safe now."
        confirmLabel="I've saved them"
        busy={false}
        error={null}
        onConfirm={() => setRecoveryCodes([])}
        onCancel={() => setRecoveryCodes([])}
      >
        <ul className="grid grid-cols-2 gap-1.5 rounded-lg bg-black/40 p-3 font-mono text-[13px] text-white">
          {recoveryCodes.map((rc) => (
            <li key={rc} className="tracking-wider">
              {rc}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n")).catch(() => {})}
          className="mt-2.5 w-full rounded-lg border border-white/[0.12] px-3 py-2 text-[12.5px] text-white transition-colors hover:bg-white/[0.06]"
        >
          Copy all codes
        </button>
      </ConfirmDialog>

      <ConfirmDialog
        open={revoking !== null}
        title="Remove this passkey?"
        description={
          <>
            <span className="font-medium text-white">{revoking?.name || "This passkey"}</span> will
            no longer sign you in. If it is the only way you can get into this account, add another
            device first.
          </>
        }
        confirmLabel="Remove passkey"
        destructive
        busy={busy}
        error={dialogError}
        onConfirm={confirmRevokePasskey}
        onCancel={() => setRevoking(null)}
      />
    </>
  );
}
