import { useState, useEffect } from "react";
import { Icon } from "@/components/icons";

// FurlPay first-time onboarding — shown once on install.
// 3-step carousel: Pay (x402), Approve (3DS2), Save (fee scanner).
// Dismissed permanently via chrome.storage.local flag.

const ONBOARDING_KEY = "furlpay-onboarded";

interface Step {
  icon: string;
  title: string;
  desc: string;
  accent: string;
}

const STEPS: Step[] = [
  {
    icon: "💳",
    title: "Pay anywhere with stablecoins",
    desc: "When a site accepts x402 payments, FurlPay shows a one-tap checkout. Settle in USDC on Arbitrum — gas-free, instant.",
    accent: "var(--fp-accent)",
  },
  {
    icon: "🔐",
    title: "Approve with your fingerprint",
    desc: "Card purchases that need 3-D Secure pop up as notifications. Review and approve with biometrics — passkeys can't be phished.",
    accent: "var(--fp-accent-2, #64b5ff)",
  },
  {
    icon: "💰",
    title: "See what you save",
    desc: "On checkout pages, FurlPay shows what the merchant pays in card fees vs FurlPay — the Honey of payment fees.",
    accent: "#fbbf24",
  },
];

export function useOnboarding(): { shouldShow: boolean; dismiss: () => void } {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    browser.storage.local.get(ONBOARDING_KEY).then((v) => {
      if (!v[ONBOARDING_KEY]) setShouldShow(true);
    });
  }, []);

  const dismiss = () => {
    setShouldShow(false);
    void browser.storage.local.set({ [ONBOARDING_KEY]: true });
  };

  return { shouldShow, dismiss };
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fade-up" style={{ padding: "20px 20px 14px", textAlign: "center" }}>
      {/* Progress dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
        {STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === step ? 20 : 6,
              height: 6,
              borderRadius: 3,
              background: i === step ? "var(--fp-accent)" : "var(--fp-border-glass)",
              transition: "width 0.3s ease, background 0.3s ease",
            }}
          />
        ))}
      </div>

      {/* Icon */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background: "var(--fp-bg-secondary)",
          border: "1px solid var(--fp-border-glass)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 16px",
          fontSize: 32,
        }}
      >
        {current.icon}
      </div>

      {/* Title */}
      <div style={{ fontSize: "1.05rem", fontWeight: 800, letterSpacing: "-0.3px", marginBottom: 8 }}>
        {current.title}
      </div>

      {/* Description */}
      <p
        style={{
          fontSize: "0.8rem",
          color: "var(--fp-text-secondary)",
          lineHeight: 1.55,
          maxWidth: 300,
          margin: "0 auto 24px",
        }}
      >
        {current.desc}
      </p>

      {/* Security trust strip */}
      <div
        className="glass-panel"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          marginBottom: 20,
          textAlign: "left",
          fontSize: "0.72rem",
          color: "var(--fp-text-muted)",
        }}
      >
        <span style={{ color: "var(--fp-accent)", display: "flex" }}>
          <Icon name="security" size={16} />
        </span>
        No keys, no tokens stored in the extension. Your session lives on furlpay.com.
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn-ghost"
          style={{ flex: 1, padding: "10px" }}
          onClick={() => {
            void browser.storage.local.set({ [ONBOARDING_KEY]: true });
            onDone();
          }}
        >
          Skip
        </button>
        <button
          className="btn-primary"
          style={{ flex: 1.5, padding: "10px" }}
          onClick={() => {
            if (isLast) {
              void browser.storage.local.set({ [ONBOARDING_KEY]: true });
              onDone();
            } else {
              setStep((s) => s + 1);
            }
          }}
        >
          {isLast ? "Get started" : "Next"}
        </button>
      </div>
    </div>
  );
}
