"use client";

import { useState } from "react";
import { Monitor } from "lucide-react";
import { NotWiredError, revokeSession, type Device, type Profile } from "@/lib/accountApi";
import { timeAgo } from "@/components/ui";
import ConfirmDialog from "./ConfirmDialog";
import {
  ActionButton,
  EmptyState,
  Feedback,
  NotWiredNote,
  Row,
  Section,
  StatusPill,
} from "./primitives";

// ---------------------------------------------------------------------------
// Active sessions.
//
// The current device is marked, and it is the one row without a Revoke button:
// ending your own session from here is a sign-out, and the sign-out control
// lives in the profile menu where people already look for it.
//
// Revoking ANOTHER device is not wired. `security.devices` is descriptive
// account state, and /api/auth/logout revokes only the jti of the session that
// calls it — there is no per-session table to target a different device with.
// The button therefore reports that rather than appearing to succeed, which on
// a security screen is the difference between an honest gap and a user who
// believes they have kicked an intruder out.
// ---------------------------------------------------------------------------

export default function SessionsSection({ profile }: { profile: Profile }) {
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const devices = profile.security.devices ?? [];
  const others = devices.filter((d) => !d.current);

  async function doRevoke(all: boolean) {
    setBusy(true);
    setDialogError(null);
    try {
      await revokeSession(all ? "*" : (revoking?.name ?? ""));
      setRevoking(null);
      setConfirmAll(false);
      setFeedback({ tone: "success", text: "Session ended." });
    } catch (err) {
      setDialogError(
        err instanceof NotWiredError
          ? "Ending another device's session needs a per-session record that does not exist yet. If you think someone else has access, lock your account from the Security section — that stops money movement immediately."
          : "Could not end that session."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="Active sessions"
        description="Where your account is currently signed in."
        id="sessions"
        action={
          others.length > 0 ? (
            <ActionButton
              variant="danger"
              onClick={() => {
                setDialogError(null);
                setConfirmAll(true);
              }}
            >
              Sign out other sessions
            </ActionButton>
          ) : undefined
        }
      >
        {devices.length === 0 ? (
          <EmptyState>No other sessions are signed in to this account.</EmptyState>
        ) : (
          devices.map((d) => (
            <Row
              key={`${d.name}-${d.lastActive}`}
              label={
                <span className="flex items-center gap-2">
                  <Monitor className="h-3.5 w-3.5 shrink-0 text-textSecondary" aria-hidden />
                  {d.name}
                </span>
              }
              hint={`${d.location} · last active ${timeAgo(d.lastActive)}`}
            >
              {d.current ? (
                <StatusPill tone="gain">This device</StatusPill>
              ) : (
                <ActionButton
                  variant="danger"
                  onClick={() => {
                    setDialogError(null);
                    setRevoking(d);
                  }}
                  ariaLabel={`Sign out ${d.name}`}
                >
                  Sign out
                </ActionButton>
              )}
            </Row>
          ))
        )}

        {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}

        <NotWiredNote>
          This list is read from your account. Ending a session on another device needs a
          session-per-device record keyed by token id, which the sign-out route does not keep yet.
        </NotWiredNote>
      </Section>

      <ConfirmDialog
        open={revoking !== null}
        title={`Sign out ${revoking?.name ?? "this device"}?`}
        description="That device will need to sign in again. Your current session is not affected."
        confirmLabel="Sign out device"
        destructive
        busy={busy}
        error={dialogError}
        onConfirm={() => doRevoke(false)}
        onCancel={() => setRevoking(null)}
      />

      <ConfirmDialog
        open={confirmAll}
        title="Sign out all other sessions?"
        description="Every device except this one will need to sign in again."
        confirmLabel="Sign out others"
        destructive
        busy={busy}
        error={dialogError}
        onConfirm={() => doRevoke(true)}
        onCancel={() => setConfirmAll(false)}
      />
    </>
  );
}
