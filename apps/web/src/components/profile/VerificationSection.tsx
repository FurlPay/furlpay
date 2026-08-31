"use client";

import { useState } from "react";
import { NotWiredError, startVerification, type Profile } from "@/lib/accountApi";
import { ActionButton, Feedback, NotWiredNote, Row, Section, StatusPill } from "./primitives";

// ---------------------------------------------------------------------------
// Identity verification (KYC).
//
// `kycStatus` and `kycTier` are read-only account state: a signed webhook from
// a verification provider is what moves them, and no route on this deployment
// starts such a flow. So this section reports the tier the account actually has
// and says what each tier unlocks — it does not offer a form that would collect
// identity documents with nowhere to send them, which is the worst possible way
// to be wrong about KYC.
//
// The tier ceilings are the ones the transfer route enforces (packages/
// compliance kycTiers.ts), so the explanation here matches what a payment will
// actually do rather than being marketing copy written alongside it.
// ---------------------------------------------------------------------------

const TIERS = [
  { tier: 0, name: "Unverified", cap: "$50 per transfer" },
  { tier: 1, name: "Basic", cap: "$1,000 per transfer" },
  { tier: 2, name: "Standard", cap: "$10,000 per transfer" },
  { tier: 3, name: "Enhanced", cap: "$100,000 per transfer" },
] as const;

export default function VerificationSection({ profile }: { profile: Profile }) {
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const verified = profile.kycStatus === "verified";
  const pending = profile.kycStatus === "pending";

  async function begin() {
    setFeedback(null);
    try {
      const { url } = await startVerification();
      window.location.assign(url);
    } catch (err) {
      setFeedback({
        tone: "error",
        text:
          err instanceof NotWiredError
            ? "Verification is not open on this deployment yet. Your current limits still apply, and nothing about your account has changed."
            : "Could not start verification. Please try again.",
      });
    }
  }

  return (
    <Section
      title="Verification"
      description="Higher verification tiers raise how much you can move in a single transfer."
      id="verification"
    >
      <Row
        label="Verification status"
        hint={
          verified
            ? "Your identity has been confirmed."
            : pending
              ? "Your documents are being reviewed. This usually takes a few minutes."
              : "You have not verified your identity yet."
        }
      >
        <StatusPill tone={verified ? "gain" : pending ? "accent" : "muted"}>
          {verified ? "Verified" : pending ? "In review" : "Not verified"}
        </StatusPill>
      </Row>

      {/* Progress across the tiers, as a real ladder rather than a percentage
          bar — the tiers are discrete and each one has a different meaning. */}
      <div className="px-4 py-3.5">
        <ol className="flex flex-wrap gap-1.5" aria-label="Verification tiers">
          {TIERS.map((t) => {
            const reached = t.tier === 0 || verified;
            return (
              <li
                key={t.tier}
                className={`flex-1 rounded-lg border px-2.5 py-2 text-[11px] ${
                  reached
                    ? "border-gain/30 bg-gain/[0.07] text-gain"
                    : "border-white/[0.08] bg-white/[0.02] text-textMuted"
                }`}
              >
                <span className="block font-semibold">{t.name}</span>
                <span className="block">{t.cap}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {!verified && (
        <Row
          label="Verify your identity"
          hint="Needed before you can move larger amounts, and to receive payouts from programs that require it."
        >
          <ActionButton variant="primary" onClick={begin} disabled={pending}>
            {pending ? "In review" : "Start verification"}
          </ActionButton>
        </Row>
      )}

      {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}

      <NotWiredNote>
        Verification status is read from your account and can only be changed by a verification
        provider. Wiring the flow means a provider session, a hosted form and a signed webhook — the
        browser must never be able to set its own KYC tier.
      </NotWiredNote>
    </Section>
  );
}
