import * as fs from "fs";
import * as path from "path";

// The web claims linter (apps/web/scripts/check-claims.mjs) never sees the
// native app. On 2026-10-01 the native checkout still said "Rate locked for
// 15:00", "Travel Rule & KYC enforced over $1,000" and "Visa · Mastercard ·
// Amex" after the web had removed all three: no provider holds a rate, nothing
// enforces KYC in the booking path, and no card processor exists. This keeps
// the travel screens honest the same way.

const TRAVEL = path.join(__dirname, "..", "..", "app", "travel");

function screens(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) screens(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

// Prose only: comments are stripped so an explanation of a removed claim does
// not trip the check.
const prose = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const UNSUPPORTED: [RegExp, string][] = [
  [/rate locked|rate lock expired|rate locks? \d|rate locks? \{/i, "rate lock (only a client-side quote timer exists)"],
  [/travel rule\s*&\s*kyc enforced/i, "Travel Rule / KYC enforcement (not enforced in the booking path)"],
  [/mastercard|\bamex\b|american express/i, "card networks (no card processor is attached)"],
  [/300\+ airlines/i, "airline coverage (Duffel production key not configured)"],
  [/price match guarantee/i, "price match (no claim or payout path)"],
  [/auto-deposit|deposited automatically/i, "cashback auto-deposit (travel rewards not live)"],
  [/no pci scope|pci[- ]compliant|lowest pci bracket/i, "PCI scope (a formal-assessment determination)"],
  [/instant confirmation|settles in about a second/i, "instant confirmation / finality"],
];

describe("native travel screens make no unsupported claims", () => {
  const files = screens(TRAVEL);

  it("found the travel screens", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(UNSUPPORTED)("no %s", (pattern, what) => {
    const hits = files.filter((f) => pattern.test(prose(fs.readFileSync(f, "utf8")))).map((f) => path.relative(TRAVEL, f));
    expect({ what, hits }).toEqual({ what, hits: [] });
  });
});
