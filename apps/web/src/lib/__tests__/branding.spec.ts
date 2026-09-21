// ---------------------------------------------------------------------------
// Brand regression guard.
//
// WHY THIS IS A TEST AND NOT A STYLE NOTE
// =======================================
// A misspelt brand on the sign-in screen is a phishing tell. Users are taught
// to check the name on the page they type credentials into, so "Furipay" where
// "FurlPay" belongs trains exactly the wrong reflex -- and it is the single
// easiest defect to reintroduce, because `rl` and `ri` are near-identical in a
// condensed sans at button size. That is also why it gets reported as a typo
// when nothing is actually wrong: this suite settles the question mechanically
// instead of by squinting.
//
// Scope is the AUTH surfaces plus the shared brand-mark components. It is not
// a repo-wide rename: 1,143 legitimate `Furlpay` strings exist elsewhere and
// this suite deliberately does not touch them.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const WEB = resolve(__dirname, "../..");           // apps/web/src
const REPO = resolve(WEB, "../../..");             // repo root
const NATIVE = join(REPO, "native-app");

/** Auth-facing sources across all three platforms. */
const TARGETS = [
  join(WEB, "app/login/page.tsx"),
  join(WEB, "app/signup/page.tsx"),
  join(WEB, "components/GoogleSignInButton.tsx"),
  join(WEB, "components/AppleSignInButton.tsx"),
  join(WEB, "components/BrandMarks.tsx"),
  join(NATIVE, "app/(auth)/login.tsx"),
  join(NATIVE, "components/BrandMarks.tsx"),
].filter((p) => existsSync(p));

/**
 * Every way the brand has been, or could plausibly be, mis-rendered.
 * `Furlpay` is NOT here: it is a legitimate historical casing used widely
 * elsewhere in the repo, and the HTTP header `X-Furlpay-Client` depends on it.
 */
const MISSPELLINGS = [/Furipay/i, /FuriPay/, /Furlpai/i, /Fulrpay/i, /Furlpy/i, /Furl\s+Pay/];

describe("brand regression — auth surfaces", () => {
  it("has auth surfaces to check (guards against the glob silently matching nothing)", () => {
    expect(TARGETS.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of TARGETS) {
    const rel = file.replace(REPO, "").replace(/\\/g, "/");

    it(`${rel} contains no misspelt brand`, () => {
      const src = readFileSync(file, "utf8");
      for (const re of MISSPELLINGS) {
        expect(src, `${rel} matched ${re}`).not.toMatch(re);
      }
    });
  }

  it("both login screens render the brand as FurlPay, split treatment included", () => {
    // The wordmark is two-tone -- "Furl" plain, "Pay" in the accent colour --
    // so the capital P has to survive the split. Rendering `Furl` + `pay`
    // spells the brand wrong even though each half looks right in isolation.
    const web = readFileSync(join(WEB, "app/login/page.tsx"), "utf8");
    expect(web).toMatch(/Furl<span[^>]*>Pay<\/span>/);

    const native = join(NATIVE, "app/(auth)/login.tsx");
    if (existsSync(native)) {
      expect(readFileSync(native, "utf8")).toMatch(/Furl<Text[^>]*>Pay<\/Text>/);
    }
  });

  it("keeps the product tagline exactly as the brand defines it", () => {
    const web = readFileSync(join(WEB, "app/login/page.tsx"), "utf8");
    expect(web).toContain("The stablecoin super-app.");
  });

  it("does not leave a stray leading space where an icon was stripped", () => {
    // The passkey button shipped as `" Sign in with Fingerprint"` -- an emoji
    // had been removed and its space left behind, rendering as a visible
    // indent. Icons are components now; a leading space means one was ripped
    // out again.
    const web = readFileSync(join(WEB, "app/login/page.tsx"), "utf8");
    expect(web).not.toMatch(/"\s+Sign in with/);
    expect(web).not.toMatch(/"\s+Continue with/);
  });
});

describe("brand regression — no monochrome provider logos", () => {
  it("the native login does not substitute Ionicons for the Google or Apple mark", () => {
    const native = join(NATIVE, "app/(auth)/login.tsx");
    if (!existsSync(native)) return;
    const src = readFileSync(native, "utf8");
    // Google is explicit that monochrome versions and custom icons are
    // prohibited; Apple requires its own mark. Both were Ionicons glyphs.
    expect(src).not.toMatch(/logo-google/);
    expect(src).not.toMatch(/logo-apple/);
  });

  it("the shared Google mark keeps all four brand colours", () => {
    for (const p of [join(WEB, "components/GoogleSignInButton.tsx"), join(NATIVE, "components/BrandMarks.tsx")]) {
      if (!existsSync(p)) continue;
      const src = readFileSync(p, "utf8");
      for (const hex of ["#EA4335", "#4285F4", "#FBBC05", "#34A853"]) {
        expect(src, `${p} is missing ${hex}`).toContain(hex);
      }
    }
  });
});

/** Nothing below this line should be needed; kept so the helper is exercised. */
describe("brand guard self-check", () => {
  it("would catch a misspelling if one were introduced", () => {
    const sample = "Welcome to Furipay";
    expect(MISSPELLINGS.some((re) => re.test(sample))).toBe(true);
  });

  it("does not flag the legitimate header identifier", () => {
    const sample = 'headers["x-furlpay-client"] = "mobile-android/2.1.0"';
    expect(MISSPELLINGS.some((re) => re.test(sample))).toBe(false);
  });
});

/** Sanity: the directory walk used above is not silently empty. */
function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).length;
}
describe("fixture sanity", () => {
  it("apps/web/src/components exists and is populated", () => {
    expect(countFiles(join(WEB, "components"))).toBeGreaterThan(0);
  });
});
