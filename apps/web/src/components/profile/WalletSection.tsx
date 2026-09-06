"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NotWiredError, disconnectWallet, getLinkedWallet, type LinkedWalletInfo, type Profile } from "@/lib/accountApi";
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
} from "./primitives";

// ---------------------------------------------------------------------------
// Wallet and payment methods.
//
// The important distinction this section has to keep straight — and which the
// old profile page did not — is between the two addresses on an account:
//
//   linkedWallet   The user's REAL self-custodial address, proven by an EIP-191
//                  signature from their device key. This is a wallet they
//                  control. Read from GET /api/wallet/link.
//
//   safeAddress    A deterministic placeholder derived from a hash. store.ts
//                  calls it DEPRECATED, says it "controls nothing on-chain" and
//                  warns it must NEVER be reinterpreted as a real wallet. The
//                  old page printed it under the user's name in monospace,
//                  where it reads exactly like a wallet address someone might
//                  send funds to. It is labelled as an account reference here.
//
// Payment methods are not duplicated: cards live on /cards, which is the
// surface that can actually issue, freeze and reveal them.
// ---------------------------------------------------------------------------

export default function WalletSection({ profile }: { profile: Profile }) {
  const [linked, setLinked] = useState<LinkedWalletInfo | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    getLinkedWallet()
      .then((r) => setLinked(r.linked))
      // A 404 means this deployment has wallet linking switched off; either way
      // there is no linked wallet to show.
      .catch(() => setLinked(null));
  }, []);

  async function confirmDisconnect() {
    setBusy(true);
    setDialogError(null);
    try {
      await disconnectWallet();
      setConfirming(false);
      setLinked(null);
      setFeedback({ tone: "success", text: "Wallet disconnected." });
    } catch (err) {
      setDialogError(
        err instanceof NotWiredError
          ? "Disconnecting is not available yet — unlinking a proven address needs the same re-authentication the link did."
          : "Could not disconnect this wallet."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="Wallet & payments"
        description="The self-custodial address linked to this account, and where your cards live."
        id="wallet"
      >
        {linked === undefined ? (
          <RowSkeleton rows={2} />
        ) : linked ? (
          <>
            <Row
              label="Connected wallet"
              hint={
                <span className="break-all font-mono text-[11.5px]">{linked.address}</span>
              }
            >
              <StatusPill tone={linked.status === "active" ? "gain" : "muted"}>
                {linked.status}
              </StatusPill>
              <ActionButton
                variant="danger"
                onClick={() => {
                  setDialogError(null);
                  setConfirming(true);
                }}
              >
                Disconnect
              </ActionButton>
            </Row>
            <Row
              label="Proof"
              hint={`${linked.chainFamily} · verified by ${linked.verificationMethod}${
                linked.verifiedAt ? ` · ${timeAgo(linked.verifiedAt)}` : ""
              }`}
            />
          </>
        ) : (
          <EmptyState>
            No self-custodial wallet linked. Linking proves you control an address by signing a
            challenge with it — FurlPay never sees your keys.
          </EmptyState>
        )}

        {!linked && linked !== undefined && (
          <Row label="Connect a wallet" hint="Prove ownership of an address you already control.">
            <Link
              href="/dashboard"
              className="tap rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Start linking
            </Link>
          </Row>
        )}

        <Row
          label="Account reference"
          hint="An internal identifier for this account — not a wallet, and not an address to send funds to."
        >
          <span className="break-all font-mono text-[11.5px] text-textMuted">
            {profile.accountReference}
          </span>
        </Row>

        <Row label="Cards and payment methods" hint="Issue, freeze and manage your FurlPay cards.">
          <Link
            href="/cards"
            className="tap rounded-lg border border-white/[0.14] px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
          >
            Open cards
          </Link>
        </Row>

        {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}

        <NotWiredNote>
          Disconnecting a linked wallet needs a step-up-guarded endpoint that does not exist yet, so
          the button reports rather than silently doing nothing.
        </NotWiredNote>
      </Section>

      <ConfirmDialog
        open={confirming}
        title="Disconnect this wallet?"
        description="FurlPay will stop treating this address as yours. Your funds are unaffected — the keys are on your own device — and you can prove ownership again at any time."
        confirmLabel="Disconnect"
        destructive
        busy={busy}
        error={dialogError}
        onConfirm={confirmDisconnect}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
