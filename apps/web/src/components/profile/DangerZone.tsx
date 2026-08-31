"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDeletionPreview, type DeletionPreview } from "@/lib/accountApi";
import { clearOfflineData } from "@/lib/offline";
import { ActionButton, Row, Section } from "./primitives";

// ---------------------------------------------------------------------------
// Account deletion. Ported from the previous /profile page WITHOUT changing
// what it does — only how it is laid out — because three of its properties are
// load-bearing and easy to lose in a redesign:
//
//  1. It does NOT claim total erasure. The retention list comes from the server
//     (GET /api/account), so the copy the user reads is what the API actually
//     enforces rather than a paragraph written next to it.
//  2. Self-custodial wallet material lives on the user's own device. Deleting
//     the FurlPay account does not, and cannot, move their funds — and the page
//     says so before they type DELETE.
//  3. A bare session is not enough: the server requires a recent step-up. When
//     this session has not re-authenticated, the UI sends the user to sign in
//     again rather than firing a request it knows will 403.
// ---------------------------------------------------------------------------

export default function DangerZone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || preview) return;
    getDeletionPreview()
      .then(setPreview)
      .catch(() => setError("Could not load deletion details."));
  }, [open, preview]);

  async function destroy() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account", { method: "DELETE" }).catch(() => null);
    if (!res) {
      setBusy(false);
      return setError("Network error — your account was not deleted.");
    }
    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
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
    // The account is gone server-side; scrub every local trace before leaving.
    await clearOfflineData();
    router.push("/login?deleted=1");
  }

  const armed = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <Section title="Danger zone" id="danger">
      {!open ? (
        <Row
          label="Delete your FurlPay account"
          hint="Permanent. You will be signed out everywhere and will not be able to sign in again."
        >
          <ActionButton variant="danger" onClick={() => setOpen(true)}>
            Delete account
          </ActionButton>
        </Row>
      ) : (
        <div className="px-4 py-4">
          <h3 className="text-[14px] font-bold text-loss">Delete your FurlPay account</h3>

          <p className="mt-3 text-[12.5px] font-semibold text-white">This will be deleted</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-textSecondary">
            Your profile and contact details, passkeys and linked sign-ins, balances, cards, bills,
            transaction history, trips, support conversations, agent keys, and push registrations.
            You will be signed out on every device and will not be able to sign in again.
          </p>

          {preview && preview.retained.length > 0 && (
            <>
              <p className="mt-4 text-[12.5px] font-semibold text-white">This will be kept</p>
              <ul className="mt-1 space-y-1.5">
                {preview.retained.map((r) => (
                  <li key={r.record} className="text-[12.5px] leading-relaxed text-textSecondary">
                    <span className="font-medium text-white">{r.record}</span> — {r.reason}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-4 text-[12.5px] font-semibold text-white">Your self-custodial wallet</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-textSecondary">
            Your recovery phrase is held on your own device, not by FurlPay. Deleting your account
            does not move, return or destroy any on-chain funds, and we cannot recover the phrase
            for you afterwards. If you hold a balance in that wallet,{" "}
            <span className="font-medium text-white">back up your recovery phrase first</span>.
          </p>

          {preview && !preview.stepUpSatisfied ? (
            <>
              <p className="mt-4 text-[12.5px] text-textSecondary">
                For your security, deleting an account requires a recent sign-in.
              </p>
              <div className="mt-3">
                <ActionButton
                  variant="primary"
                  onClick={() => router.push("/login?next=/profile")}
                >
                  Sign in again to continue
                </ActionButton>
              </div>
            </>
          ) : (
            preview && (
              <>
                <label htmlFor="confirm-delete" className="mt-4 block text-[12.5px] text-textSecondary">
                  Type <span className="font-mono font-semibold text-white">DELETE</span> to confirm.
                </label>
                <input
                  id="confirm-delete"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  className="mt-2 w-full max-w-[280px] rounded-lg border border-white/[0.12] bg-black/40 px-3 py-2.5 font-mono text-[13.5px] text-white outline-none focus-visible:border-loss focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-loss"
                />
                <div className="mt-3">
                  <ActionButton variant="danger" onClick={destroy} disabled={!armed || busy}>
                    {busy ? "Deleting…" : "Permanently delete my account"}
                  </ActionButton>
                </div>
              </>
            )
          )}

          {error && (
            <p role="alert" className="mt-3 text-[12.5px] text-loss">
              {error}
            </p>
          )}

          <div className="mt-3">
            <ActionButton
              onClick={() => {
                setOpen(false);
                setError(null);
                setConfirmText("");
              }}
              disabled={busy}
            >
              Cancel
            </ActionButton>
          </div>
        </div>
      )}
    </Section>
  );
}
