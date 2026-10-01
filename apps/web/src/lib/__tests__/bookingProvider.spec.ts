import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Cal.com is the booking system of record.
//
// The founder call used to be a Calendly iframe
// (calendly.com/founder-furlpay/30min). It is now the Cal.com embed for
// cal.com/furlpay/30min. A half-finished provider migration is the kind of
// thing that survives review and then strands a customer on a dead scheduler:
// one forgotten CTA still pointing at an inbox nobody watches, or a CSP that
// still trusts the old origin.
//
// So this pins both ends of the swap:
//   1. No Calendly reference survives anywhere in the app source or config.
//   2. The CSP actually permits the new origin — both as a script origin (the
//      embed injects and sizes the iframe) and as a frame origin. Dropping
//      either one renders a blank modal in production while every test passes.
// ---------------------------------------------------------------------------

const WEB_ROOT = join(__dirname, "..", "..", "..");
const SRC = join(WEB_ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|json|md|mdx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("booking provider migration", () => {
  const files = walk(SRC).filter((f) => !f.endsWith("bookingProvider.spec.ts"));

  it("scans a non-trivial number of files", () => {
    // Guards the guard — a wrong root would make the sweep below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  // The guard is the ORIGIN, not the word: prose explaining what we migrated
  // away from is useful and harmless, a reachable calendly.com URL is not.
  it("has no calendly.com endpoint left in src/", () => {
    const offenders = files.filter((f) => /calendly\.com/i.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(WEB_ROOT.length + 1))).toEqual([]);
  });

  it("has no calendly.com endpoint left in next.config.js", () => {
    const cfg = readFileSync(join(WEB_ROOT, "next.config.js"), "utf8");
    expect(/calendly\.com/i.test(cfg)).toBe(false);
  });

  it("points the scheduler at the Cal.com event", () => {
    const src = readFileSync(
      join(SRC, "components", "marketing", "ScheduleCallButton.tsx"),
      "utf8",
    );
    expect(src).toContain('"furlpay/30min"');
    expect(src).toContain("https://app.cal.com/embed/embed.js");
  });

  it("allows app.cal.com as BOTH a script and a frame origin in the CSP", () => {
    const cfg = readFileSync(join(WEB_ROOT, "next.config.js"), "utf8");
    const line = (name: string) =>
      // The directive may be a plain string or a template literal (the
      // production-only 'unsafe-eval' switch made script-src one), so accept
      // either opening quote.
      cfg.split("\n").find((l) => l.includes(`"${name} `) || l.includes("`" + name + " ")) ?? "";

    // The embed script is what injects the booker, so script-src is not
    // optional here — with only frame-src the modal renders empty.
    expect(line("script-src"), "script-src must allow app.cal.com").toContain(
      "https://app.cal.com",
    );
    expect(line("frame-src"), "frame-src must allow app.cal.com").toContain(
      "https://app.cal.com",
    );
  });
});
