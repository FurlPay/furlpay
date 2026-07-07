"use client";

import { useRef, useState } from "react";
import { BadgeCheck, Camera, Loader2, Check, Instagram, X } from "lucide-react";
import type { CreatorView } from "@/lib/creator";
import AvatarCropper from "./AvatarCropper";

const BIO_MAX = 150;

// Round avatar with an initials fallback (89%-convention identity element).
export function Avatar({ name, avatarUrl, size = 48 }: { name: string; avatarUrl?: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || "C";
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-neon/15 font-bold text-neon"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initial}
    </div>
  );
}

export default function ProfileEditor({
  creator,
  onSaved,
  onClose,
}: {
  creator: CreatorView;
  onSaved: (updated: CreatorView) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(creator.name);
  const [bio, setBio] = useState(creator.bio ?? "");
  const [country, setCountry] = useState(creator.country ?? "");
  const [website, setWebsite] = useState(creator.website ?? "");
  const [wallet, setWallet] = useState(creator.wallet ?? "");
  const [avatarUrl, setAvatarUrl] = useState(creator.avatarUrl ?? "");

  const [cropFile, setCropFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    name !== creator.name ||
    bio !== (creator.bio ?? "") ||
    country !== (creator.country ?? "") ||
    website !== (creator.website ?? "") ||
    wallet !== (creator.wallet ?? "") ||
    avatarUrl !== (creator.avatarUrl ?? "");

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setCropFile(f);
    e.target.value = ""; // allow re-picking the same file
  }

  async function syncInstagram() {
    if (!creator.handle) {
      setError("Add your Instagram handle first.");
      return;
    }
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/ambassadors/instagram?handle=${encodeURIComponent(creator.handle)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not reach Instagram.");
      const p = json.profile as { name: string; biography: string; followersCount: number; profilePictureUrl?: string };
      if (p.name) setName(p.name);
      if (p.biography) setBio(p.biography.slice(0, BIO_MAX));
      if (p.profilePictureUrl) setAvatarUrl(p.profilePictureUrl);
      setNotice(
        `Synced from Instagram — ${p.followersCount.toLocaleString("en-US")} followers${json.mocked ? " (demo data)" : ""}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ambassadors?email=${encodeURIComponent(creator.email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, bio, country, website, wallet, avatarUrl }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not save.");
      onSaved(json.creator as CreatorView);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
      setSaving(false);
    }
  }

  const field =
    "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] text-textPrimary placeholder:text-textSecondary focus:border-neon/50 focus:outline-none";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Edit profile">
        <div className="my-4 w-full max-w-lg rounded-3xl border border-white/10 bg-charcoal p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-extrabold tracking-tight text-textPrimary">Edit profile</h2>
            <button onClick={onClose} aria-label="Close" className="text-textSecondary hover:text-textPrimary">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Avatar */}
          <div className="mt-6 flex items-center gap-4">
            <div className="relative">
              <Avatar name={name} avatarUrl={avatarUrl} size={72} />
              <button
                onClick={() => fileRef.current?.click()}
                aria-label="Change photo"
                className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-charcoal bg-neon text-black"
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>
            <div>
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-pill border border-white/15 px-4 py-2 text-[13px] font-semibold text-textPrimary transition-colors hover:border-white/40"
              >
                Change photo
              </button>
              {avatarUrl && (
                <button
                  onClick={() => setAvatarUrl("")}
                  className="ml-2 text-[13px] text-textSecondary hover:text-red-400"
                >
                  Remove
                </button>
              )}
              <p className="mt-1.5 text-[11px] text-textSecondary">JPG, PNG or WebP. Square works best.</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
          </div>

          {/* Sync from Instagram */}
          <button
            onClick={syncInstagram}
            disabled={syncing}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-neon/30 bg-neon/[0.06] py-2.5 text-[13px] font-semibold text-neon transition-colors hover:bg-neon/[0.1] disabled:opacity-60"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Instagram className="h-4 w-4" />}
            {syncing ? "Syncing…" : "Sync name, bio & followers from Instagram"}
          </button>

          {/* Fields */}
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-textSecondary">Display name</label>
              <div className="relative">
                <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                {creator.kycVerified && (
                  <BadgeCheck className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neon" aria-label="Verified" />
                )}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="block text-[12px] font-semibold text-textSecondary">Bio</label>
                <span className={`text-[11px] ${bio.length > BIO_MAX ? "text-red-400" : "text-textSecondary"}`}>
                  {bio.length}/{BIO_MAX}
                </span>
              </div>
              <textarea
                className={`${field} min-h-[80px] resize-y`}
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
                placeholder="Travel creator sharing trips & tips ✈️"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-textSecondary">Country</label>
                <input className={field} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Portugal" />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-textSecondary">Website</label>
                <input className={field} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yoursite.com" />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-textSecondary">Payout wallet (USDC)</label>
              <input className={`${field} font-mono`} value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" />
            </div>
          </div>

          {notice && <p className="mt-4 text-[13px] text-neon">{notice}</p>}
          {error && <p className="mt-4 text-[13px] text-red-400">{error}</p>}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-pill border border-white/15 px-5 py-2.5 text-[14px] font-semibold text-textPrimary transition-colors hover:border-white/40"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving || bio.length > BIO_MAX || !name.trim()}
              className="flex items-center justify-center gap-2 rounded-pill bg-neon px-6 py-2.5 text-[14px] font-semibold text-black transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          onSave={(dataUrl) => {
            setAvatarUrl(dataUrl);
            setCropFile(null);
          }}
          onCancel={() => setCropFile(null)}
        />
      )}
    </>
  );
}
