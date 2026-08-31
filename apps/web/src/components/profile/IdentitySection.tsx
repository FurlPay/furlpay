"use client";

import { useRef, useState } from "react";
import { User as UserIcon } from "lucide-react";
import {
  NotWiredError,
  patchProfile,
  setUsername,
  uploadAvatar,
  type Profile,
} from "@/lib/accountApi";
import { ActionButton, Feedback, NotWiredNote, Row, Section, StatusPill } from "./primitives";

// ---------------------------------------------------------------------------
// Who the account belongs to: picture, display name, handle, email, standing.
//
// Two of these five are editable today and three are not, and the section is
// built so the difference is visible rather than discovered by clicking:
//
//   display name  REAL — PATCH /api/profile has always validated and stored a
//                 name; the old page was the first thing to ever send one.
//   picture       The provider's photo is shown, but there is nowhere to upload
//                 a new one (no object storage on this deployment). The control
//                 is present and reports that plainly instead of opening a file
//                 picker that leads nowhere.
//   username      No handle field exists on the account record at all.
//   email         Read-only by design — changing it is an identity change that
//                 has to re-verify, not a text field.
//   standing      Derived server state (tier, KYC, lock), never editable here.
// ---------------------------------------------------------------------------

export default function IdentitySection({
  profile,
  onChanged,
}: {
  profile: Profile;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (!next || next === profile.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await patchProfile({ name: next });
      setEditing(false);
      onChanged();
      setFeedback({ tone: "success", text: "Display name updated." });
    } catch (err) {
      // The server validates length and character set and its wording is more
      // useful than a generic failure line.
      setFeedback({
        tone: "error",
        text: err instanceof Error ? err.message : "Could not save your name.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Let the same file be chosen again after a failure.
    e.target.value = "";
    if (!file) return;
    setFeedback(null);
    try {
      await uploadAvatar(file);
      onChanged();
      setFeedback({ tone: "success", text: "Profile photo updated." });
    } catch (err) {
      setFeedback({
        tone: "error",
        text:
          err instanceof NotWiredError
            ? "Uploading a photo is not available on this deployment yet. Your picture comes from the account you signed in with."
            : "Could not upload that image. Try a JPEG or PNG under 2 MB.",
      });
    }
  }

  async function onEditUsername() {
    setFeedback(null);
    try {
      await setUsername("");
      onChanged();
    } catch (err) {
      setFeedback({
        tone: "error",
        text:
          err instanceof NotWiredError
            ? "Usernames are not part of a FurlPay account yet — your display name and email identify you today."
            : "Could not update your username.",
      });
    }
  }

  const kycTone = profile.kycStatus === "verified" ? "gain" : profile.kycStatus === "pending" ? "accent" : "muted";

  return (
    <Section
      title="Profile"
      description="How you appear across FurlPay."
      id="profile"
    >
      {/* Identity header: picture beside the editable name. */}
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.05]">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a remote
              // provider URL; next/image would need it in remotePatterns and
              // buys nothing for a 64px square that is already cached.
              <img
                src={profile.avatarUrl}
                alt=""
                width={64}
                height={64}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : profile.initials ? (
              <span className="text-[19px] font-bold text-white">{profile.initials}</span>
            ) : (
              <UserIcon className="h-6 w-6 text-textSecondary" aria-hidden />
            )}
          </span>

          <div className="min-w-0 sm:hidden">
            <p className="truncate text-[16px] font-bold text-white">{profile.name}</p>
            <p className="truncate text-[12.5px] text-textSecondary">{profile.email}</p>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="hidden sm:block">
            {!editing && (
              <>
                <p className="truncate text-[17px] font-bold text-white">{profile.name}</p>
                <p className="truncate text-[13px] text-textSecondary">{profile.email}</p>
              </>
            )}
          </div>

          {editing && (
            <form onSubmit={saveName} className="flex flex-col gap-2">
              <label htmlFor="display-name" className="text-[12px] font-medium text-textSecondary">
                Display name
              </label>
              <input
                id="display-name"
                autoFocus
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                maxLength={50}
                className="w-full rounded-lg border border-white/[0.12] bg-black/40 px-3 py-2 text-[14px] font-semibold text-white outline-none focus-visible:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <div className="flex gap-2">
                <ActionButton type="submit" variant="primary" disabled={saving || !draft.trim()}>
                  {saving ? "Saving…" : "Save"}
                </ActionButton>
                <ActionButton
                  onClick={() => {
                    setEditing(false);
                    setDraft(profile.name);
                  }}
                  disabled={saving}
                >
                  Cancel
                </ActionButton>
              </div>
            </form>
          )}
        </div>

        {!editing && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <ActionButton
              onClick={() => {
                setDraft(profile.name);
                setEditing(true);
              }}
            >
              Edit profile
            </ActionButton>
            <ActionButton onClick={() => fileRef.current?.click()}>Change photo</ActionButton>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onPickPhoto}
          className="sr-only"
          aria-label="Upload a profile photo"
          tabIndex={-1}
        />
      </div>

      <Row label="Username" hint="Not part of a FurlPay account yet.">
        <span className="font-mono text-[12.5px] text-textMuted">—</span>
        <ActionButton onClick={onEditUsername} ariaLabel="Set a username">
          Set
        </ActionButton>
      </Row>

      <Row label="Email" hint="Used for sign-in codes and security alerts.">
        <span className="truncate text-[13px] text-textSecondary">{profile.email}</span>
      </Row>

      <Row label="Account status">
        <StatusPill tone={profile.security.accountLocked ? "loss" : "gain"}>
          {profile.security.accountLocked ? "Locked" : "Active"}
        </StatusPill>
        <StatusPill tone="accent">{profile.tier}</StatusPill>
        <StatusPill tone={kycTone}>{profile.kycStatus}</StatusPill>
      </Row>

      {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}

      <NotWiredNote>
        Your picture is the one your identity provider hosts. Uploading a custom photo and choosing
        a username both need account-side storage that this deployment does not have yet.
      </NotWiredNote>
    </Section>
  );
}
