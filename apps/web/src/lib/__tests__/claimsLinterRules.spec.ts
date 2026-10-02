import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The travel-claim rules added on 2026-10-01 (PRODUCTION_READINESS_FINAL §14)
// must actually fire, and a qualified sentence must pass. Each case lints a
// throwaway fixture via --scan-only, so nothing is written into src/.

const SCRIPT = join(process.cwd(), "scripts", "check-claims.mjs");
const dirs: string[] = [];

function lint(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "claims-"));
  dirs.push(dir);
  writeFileSync(join(dir, "page.tsx"), `export default function P() { return <p>${text}</p>; }\n`);
  const r = spawnSync(process.execPath, [SCRIPT, "--scan-only", dir], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("claims linter: travel rules", () => {
  it.each([
    ["Pay with USDC. 15-minute rate lock at checkout.", "rate-lock"],
    ["Your price guarantee lasts fifteen minutes.", "rate-lock"],
    ["Live fares from 300+ airlines.", "airline-coverage"],
    ["Our Price Match Guarantee pays in USDC.", "price-match"],
    ["Find it cheaper and we refund the difference.", "price-match"],
    ["Travel Rule &amp; KYC compliant.", "travel-compliance"],
    ["PCI DSS card handling via Stripe.", "travel-compliance"],
    ["Gift cards from $25, instant email delivery.", "gift-cards"],
    ["Hosted checkout with no PCI scope.", "pci-scope"],
    ["Earn 2% cashback, auto-deposited to your wallet.", "cashback-auto"],
    ["Instant confirmation on every ticket.", "finality"],
    ["USDC on Arbitrum settles in about a second.", "finality"],
  ])("%j is refused (%s)", (text, rule) => {
    const r = lint(text);
    expect(r.status).toBe(1);
    expect(r.out).toContain(`[${rule}]`);
  });

  it.each([
    "A 15-minute checkout quote that the server re-checks when you book.",
    "Price matching is planned and not available yet.",
  ])("honest copy passes: %j", (text) => {
    expect(lint(text).status).toBe(0);
  });
});
