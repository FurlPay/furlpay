"use client";

import { useState } from "react";
import { User as UserIcon } from "lucide-react";
import { patchProfile, setUsername, UsernameError, type Profile } from "@/lib/accountApi";
import { ActionButton, Feedback, NotWiredNote, Row, Section, StatusPill } from "./primitives";
import ProfileImageUploader from "@/components/user/ProfileImageUploader";

// ---------------------------------------------------------------------------
// Who the account belongs to: picture, display name, handle, email, standing.
//
// Two of these five are editable today and three are not, and the section is
// built so the difference is visible rather than discovered by clicking:
//
//   display name  REAL — PATCH /api/profile has always validated and stored a
//                 name; the old page was the first thing to ever send one.
//   picture       REAL — cropped to a 256px square on a canvas (no EXIF/GPS),
//                 stored per account by PUT /api/profile/avatar; falls back to
//                 the identity provider's photo, then initials.
//   username      REAL — PUT /api/profile/username (lib/username.ts, migration
//                 0029): unique, lowercase, shared rules with wallet handles.
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
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(profile.username ?? "");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

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

  async function saveUsername(e: React.FormEvent) {
    e.preventDefault();
    if (usernameSaving) return; // no duplicate submissions
    const next = usernameDraft.trim().replace(/^@/, "");
    if (!next) {
      setUsernameError("Enter a username.");
      return;
    }
    setUsernameSaving(true);
    setUsernameError(null);
    setFeedback(null);
    try {
      const saved = await setUsername(next);
      setEditingUsername(false);
      onChanged();
      setFeedback({ tone: "success", text: `Username set to @${saved}.` });
    } catch (err) {
      // The server's wording names the actual rule (taken, reserved, length).
      setUsernameError(err instanceof UsernameError ? err.message : "Could not save your username.");
    } finally {
      setUsernameSaving(false);
    }
  }

  const kycTone = profile.kycStatus === "verified" ? "gain" : "muted";
  const kycLabel = profile.kycStatus.charAt(0).toUpperCase() + profile.kycStatus.slice(1);

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
          </div>
        )}

      </div>

      <Row label="Profile picture" hint="Cropped to a square and stored with your account.">
        <ProfileImageUploader
          name={profile.name}
          initials={profile.initials}
          avatarUrl={profile.avatarUrl}
          onChange={() => onChanged()}
        />
      </Row>

      <Row
        label="Username"
        hint="Your public name on FurlPay. 3–32 letters, numbers or hyphens."
        align={editingUsername ? "start" : "center"}
      >
        {editingUsername ? (
          <form onSubmit={saveUsername} className="flex w-full min-w-0 flex-col gap-2 sm:w-auto" noValidate>
            <label htmlFor="username-input" className="sr-only">
              Username
            </label>
            <div className="flex min-w-0 items-center rounded-lg border border-white/[0.12] bg-black/40 focus-within:border-accent/60 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
              <span aria-hidden className="pl-3 font-mono text-[13px] text-textMuted">@</span>
              <input
                id="username-input"
                autoFocus
                value={usernameDraft}
                onChange={(ev) => setUsernameDraft(ev.target.value)}
                maxLength={33}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={usernameError ? true : undefined}
                aria-describedby={usernameError ? "username-error" : undefined}
                className="w-full min-w-0 bg-transparent py-2 pl-1 pr-3 font-mono text-[13px] text-white outline-none sm:w-56"
              />
            </div>
            {usernameError && (
              <p id="username-error" role="alert" className="text-[12px] font-medium text-loss">
                {usernameError}
              </p>
            )}
            <div className="flex gap-2">
              <ActionButton type="submit" variant="primary" disabled={usernameSaving || !usernameDraft.trim()}>
                {usernameSaving ? "Saving…" : "Save"}
              </ActionButton>
              <ActionButton
                onClick={() => {
                  setEditingUsername(false);
                  setUsernameError(null);
                  setUsernameDraft(profile.username ?? "");
                }}
                disabled={usernameSaving}
              >
                Cancel
              </ActionButton>
            </div>
          </form>
        ) : (
          <>
            {profile.username ? (
              <span className="min-w-0 truncate font-mono text-[13px] text-white">@{profile.username}</span>
            ) : (
              <span className="text-[12.5px] text-textMuted">Not set</span>
            )}
            <ActionButton
              onClick={() => {
                setUsernameDraft(profile.username ?? "");
                setUsernameError(null);
                setEditingUsername(true);
              }}
              ariaLabel={profile.username ? "Change your username" : "Set a username"}
            >
              {profile.username ? "Change" : "Set"}
            </ActionButton>
          </>
        )}
      </Row>

      <Row label="Email" hint="Used for sign-in codes and security alerts.">
        <span title={profile.email} className="block min-w-0 max-w-full truncate text-[13px] text-textSecondary">
          {profile.email}
        </span>
      </Row>

      <Row label="Account status">
        <StatusPill tone={profile.security.accountLocked ? "loss" : "gain"}>
          {profile.security.accountLocked ? "Locked" : "Active"}
        </StatusPill>
        <StatusPill tone="brand">{profile.tier}</StatusPill>
        <StatusPill tone={kycTone}>{kycLabel}</StatusPill>
      </Row>

      {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}

      <NotWiredNote>
        Your picture is stored with your account; if you have never set one, it falls back to the
        photo your identity provider hosts, then to your initials. A username is not a payment
        address: people pay you through your FurlPay Wallet handle.
      </NotWiredNote>
    </Section>
  );
}
