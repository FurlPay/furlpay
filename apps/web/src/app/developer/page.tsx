"use client";

import { useState } from "react";
import { PageHeader, Pill } from "@/components/ui";

const ENDPOINTS = [
  ["POST", "/api/auth/webauthn", "Passkey register / login"],
  ["GET", "/api/wallets", "Safe balances + modules"],
  ["POST", "/api/wallets/transfer", "Gas-sponsored transfer"],
  ["POST", "/api/banking", "Provision virtual account"],
  ["POST", "/api/cards", "Issue card"],
  ["POST", "/api/cards/settings", "Card controls"],
  ["POST", "/api/investing/order", "Place fractional order"],
  ["GET", "/api/investing/portfolio", "Holdings & dividends"],
  ["POST", "/api/swaps", "Cross-chain swap quote"],
  ["POST", "/api/intents", "Intent router (CCTP V2 / Li.Fi)"],
  ["POST", "/api/security/mfa", "Enroll/verify TOTP MFA"],
  ["POST", "/api/compliance/kyc", "Persona/Sumsub KYC"],
  ["GET", "/api/compliance/tier", "Tiered-KYC limits"],
  ["POST", "/api/compliance/credential", "Reusable KYC credential"],
  ["GET", "/api/compliance/jurisdiction", "Per-region policy resolver"],
  ["POST", "/api/compliance/travel-rule", "FATF Travel Rule"],
  ["POST", "/api/webhooks/card-auth", "Card auth / 3DS2"],
];

const EVENTS = [
  "card.transaction.authorized",
  "deposit.settled",
  "transfer.credited",
  "kyc.approved",
];

export default function DeveloperPage() {
  const [sandbox, setSandbox] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const apiKey = sandbox ? "sk_sandbox_furlpay_9f2c…a71b" : "sk_live_furlpay_••••••••";

  function trigger(evt: string) {
    const line = `${new Date().toLocaleTimeString()}  →  furlpay trigger ${evt}  ·  202 Accepted`;
    setLog((l) => [line, ...l].slice(0, 12));
  }

  return (
    <>
      <PageHeader title="Developers" right={<Pill tone={sandbox ? "accent" : "gain"}>{sandbox ? "Sandbox" : "Live"}</Pill>} />

      {/* Environment toggle */}
      <div className="mx-5 mb-4 flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
        <span className="text-sm font-medium">Sandbox environment</span>
        <button onClick={() => setSandbox((s) => !s)} className={`relative h-6 w-11 rounded-full ${sandbox ? "bg-accent" : "bg-white/15"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${sandbox ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      {/* API key */}
      <section className="mx-5 mb-4">
        <h2 className="mb-2 text-lg font-bold">API keys</h2>
        <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <code className="text-[13px]">{apiKey}</code>
          <button onClick={() => navigator.clipboard?.writeText(apiKey)} className="text-[12px] text-accent">Copy</button>
        </div>
      </section>

      {/* CLI hint */}
      <section className="mx-5 mb-4">
        <h2 className="mb-2 text-lg font-bold">Furlpay CLI</h2>
        <pre className="overflow-x-auto rounded-2xl bg-black p-4 text-[12px] leading-relaxed text-textSecondary">
{`npm install -g @furlpay/cli
furlpay login --key ${sandbox ? "sk_sandbox_…" : "sk_live_…"}
furlpay listen --forward-to localhost:3000/api/webhooks
furlpay trigger card.transaction.authorized
furlpay logs --tail`}
        </pre>
      </section>

      {/* Event trigger playground */}
      <section className="mx-5 mb-4">
        <h2 className="mb-2 text-lg font-bold">Trigger test events</h2>
        <div className="flex flex-wrap gap-2">
          {EVENTS.map((e) => (
            <button key={e} onClick={() => trigger(e)} className="rounded-pill bg-surface px-3 py-2 text-[12px] font-medium">
              {e}
            </button>
          ))}
        </div>
        {log.length > 0 && (
          <pre className="mt-3 max-h-40 overflow-y-auto rounded-2xl bg-black p-3 text-[11px] leading-relaxed text-gain">
            {log.join("\n")}
          </pre>
        )}
      </section>

      {/* Endpoint reference */}
      <section className="mx-5 mb-4">
        <h2 className="mb-2 text-lg font-bold">API reference</h2>
        <div className="overflow-hidden rounded-2xl bg-surface">
          {ENDPOINTS.map(([method, path, desc], i) => (
            <div key={path} className={`flex items-center gap-3 px-4 py-2.5 ${i ? "border-t border-white/5" : ""}`}>
              <span className={`w-11 shrink-0 text-[11px] font-bold ${method === "GET" ? "text-gain" : "text-accent"}`}>{method}</span>
              <code className="flex-1 truncate text-[12px]">{path}</code>
              <span className="hidden shrink-0 text-[11px] text-textSecondary sm:block">{desc}</span>
            </div>
          ))}
        </div>
        <a href="/openapi.json" className="mt-3 inline-block text-[13px] text-accent">Download OpenAPI spec →</a>
      </section>
    </>
  );
}
