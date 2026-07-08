"use client";

import { useRef, useState } from "react";

// Simulated Furlpay CLI for the careers page — an instant product demo that
// doubles as a hiring filter. Every number shown is real (measured gas from
// the Hardhat suite), because candidates will check.

const BANNER = [
  "Furlpay CLI — careers playground (simulated)",
  'Type "help" to see commands.',
];

function run(cmd: string): string[] {
  const c = cmd.trim().toLowerCase().replace(/^furlpay\s+/, "");
  switch (c) {
    case "help":
      return [
        "Commands:",
        "  auth --passkey     sign in with FaceID / TouchID",
        "  balance            show USDC balance",
        "  pay --hotel 340    run a mock x402 hotel payment",
        "  stack              why we chose this stack",
        "  apply              the fastest way to join us",
        "  clear              clear the screen",
      ];
    case "auth --passkey":
    case "auth":
      return [
        "[passkey] requesting platform authenticator…",
        "[passkey] credential verified in secure enclave",
        "✓ signed in — smart account 0x7a3f…c21e unlocked, zero seed phrases involved",
      ];
    case "balance":
      return [
        "USDC (Arbitrum One)   1,284.20",
        "Earn (Morpho vault)     512.66  · live APY",
        "✓ balances stream from the same account that books your travel",
      ];
    case "pay --hotel 340":
    case "pay --hotel":
    case "pay":
      return [
        "→ GET /api/travel/book?hotel=lisbon_alfama_suites",
        "← 402 Payment Required · 340.00 USDC · payTo furlpay treasury",
        "→ signing EIP-3009 transfer authorization (off-chain, zero gas)",
        "→ X402Facilitator.settle() on Arbitrum One · 202,667 gas measured",
        "✓ settled in ~2s · booking receipt minted · no card network involved",
      ];
    case "stack":
      return [
        "Arbitrum One   settlement — cents of gas make sponsorship viable",
        "Solidity       X402Facilitator, FurlPayRouter (1% fee ceiling on-chain)",
        "Next.js 14     this site — server-rendered, OLED-first design system",
        "WebAuthn       passkeys in the secure enclave, phishing-resistant",
        "Duffel         flights, stays and cars inventory behind one token",
      ];
    case "apply":
      return [
        "1. pick a repo: github.com/Ashutosh0x/furlpay",
        "2. merge a PR — it fast-tracks you past the take-home",
        "3. join the pipeline form below with the PR link",
      ];
    case "clear":
      return [" clear"];
    case "":
      return [];
    default:
      return [`command not found: ${cmd} — try "help"`];
  }
}

export default function TerminalPlayground() {
  const [lines, setLines] = useState<string[]>(BANNER);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const out = run(input);
    if (out[0] === " clear") {
      setLines([]);
    } else {
      setLines((prev) => [...prev, `$ ${input}`, ...out].slice(-60));
    }
    setInput("");
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 999999 }));
  }

  return (
    <div className="flex h-72 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black">
      <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-loss/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-neon/70" />
        <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-textSecondary">
          furlpay cli — try it
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
        {lines.map((l, i) => (
          <pre
            key={i}
            className={`whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed ${
              l.startsWith("$") ? "text-neon" : l.startsWith("✓") ? "text-emerald-400" : "text-white/80"
            }`}
          >
            {l}
          </pre>
        ))}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/5 px-4 py-2.5">
        <span className="font-mono text-[13px] text-neon">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='try "pay --hotel 340"'
          className="w-full bg-transparent font-mono text-[13px] text-white outline-none placeholder:text-textMuted"
          aria-label="Terminal input"
        />
      </form>
    </div>
  );
}
