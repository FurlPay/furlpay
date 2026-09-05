// The preference store touches SQLite, which has no place in a unit test.
jest.mock("../../db", () => ({
  prefGet: jest.fn(() => null),
  prefSet: jest.fn(),
}));

import {
  LOCALES,
  decimalSeparator,
  formatCompact,
  formatCurrency,
  formatNumber,
  formatToken,
  interpolate,
  parseLocaleNumber,
  plural,
  resolveLocale,
  type Locale,
} from "../core";
import { translate, translatePlural } from "../index";
import { en } from "../locales/en";
import { hi } from "../locales/hi";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { de } from "../locales/de";
import { pt } from "../locales/pt";
import { ja } from "../locales/ja";
import { ko } from "../locales/ko";
import { zh } from "../locales/zh";

const CATALOGS: Record<Locale, unknown> = { en, hi, es, fr, de, pt, ja, ko, zh };

/** Every dot-path in an object that resolves to a string. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(path);
    else out.push(...leafPaths(v, path));
  }
  return out;
}

/** `{name}` placeholders used in a template. */
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function leafAt(obj: unknown, path: string): string | undefined {
  let node: unknown = obj;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

describe("catalog completeness", () => {
  const englishPaths = leafPaths(en);

  it("ships the nine advertised locales", () => {
    expect([...LOCALES].sort()).toEqual(["de", "en", "es", "fr", "hi", "ja", "ko", "pt", "zh"]);
  });

  it("has a non-trivial number of keys", () => {
    expect(englishPaths.length).toBeGreaterThan(100);
  });

  it.each(LOCALES)("%s has every key English has", (loc) => {
    const missing = englishPaths.filter((p) => leafAt(CATALOGS[loc], p) === undefined);
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)("%s adds no key English does not have", (loc) => {
    const extra = leafPaths(CATALOGS[loc]).filter((p) => leafAt(en, p) === undefined);
    expect(extra).toEqual([]);
  });

  it.each(LOCALES)("%s preserves every placeholder", (loc) => {
    // A translation that drops {amount} renders a sentence with a hole where
    // the number should be — worse than an untranslated string.
    const mismatched: string[] = [];
    for (const p of englishPaths) {
      const source = leafAt(en, p)!;
      const target = leafAt(CATALOGS[loc], p)!;
      const a = placeholders(source);
      const b = placeholders(target);
      if (a.join(",") !== b.join(",")) mismatched.push(`${p}: [${a}] vs [${b}]`);
    }
    expect(mismatched).toEqual([]);
  });

  it.each(LOCALES)("%s leaves no value empty", (loc) => {
    const empty = leafPaths(CATALOGS[loc]).filter(
      (p) => (leafAt(CATALOGS[loc], p) ?? "").trim() === ""
    );
    expect(empty).toEqual([]);
  });

  it.each(LOCALES.filter((l) => l !== "en"))(
    "%s is actually translated, not copied English",
    (loc) => {
      // A handful of legitimate identity matches exist (brand names, "OK",
      // "Hotel" in Spanish). Anything above a small fraction means a locale was
      // stubbed out with English.
      const paths = englishPaths;
      const identical = paths.filter((p) => leafAt(CATALOGS[loc], p) === leafAt(en, p));
      expect(identical.length / paths.length).toBeLessThan(0.2);
    }
  );
});

describe("interpolate", () => {
  it("substitutes named placeholders", () => {
    expect(interpolate("Send {amount} to {name}", { amount: "$5", name: "Ana" })).toBe(
      "Send $5 to Ana"
    );
  });

  it("leaves an unknown placeholder verbatim rather than writing undefined", () => {
    // "undefined" next to a balance looks like data; "{amout}" looks like a bug.
    expect(interpolate("Pay {amout}", { amount: 5 })).toBe("Pay {amout}");
  });

  it("returns the template untouched when there are no vars", () => {
    expect(interpolate("Plain text")).toBe("Plain text");
  });
});

describe("plural", () => {
  it("uses CLDR rules, not n === 1", () => {
    const forms = { one: "one day", other: "many days" };
    expect(plural(1, forms, "en")).toBe("one day");
    expect(plural(0, forms, "en")).toBe("many days");
    // French treats 0 as singular — the exact case a n===1 check gets wrong.
    expect(plural(0, forms, "fr")).toBe("one day");
    // Japanese has a single form.
    expect(plural(1, forms, "ja")).toBe("many days");
  });

  it("falls back to `other` when a form is missing", () => {
    expect(plural(5, { other: "fallback" }, "en")).toBe("fallback");
  });
});

describe("translate", () => {
  it("resolves a key in each locale", () => {
    expect(translate("common.cancel", undefined, "en")).toBe("Cancel");
    expect(translate("common.cancel", undefined, "de")).toBe("Abbrechen");
    expect(translate("common.cancel", undefined, "ja")).toBe("キャンセル");
  });

  it("interpolates", () => {
    const out = translate("money.insufficient", { asset: "USDC", balance: "$5" }, "en");
    expect(out).toBe("Not enough USDC. You have $5.");
  });

  it("returns the key itself for an unknown path", () => {
    // Visibly broken beats invisibly blank.
    expect(translate("nope.not.here" as never, undefined, "en")).toBe("nope.not.here");
  });
});

describe("translatePlural", () => {
  it("supplies {count} without the catalog repeating it", () => {
    expect(translatePlural("plurals.transaction_plural", 1, undefined, "en")).toBe(
      "1 transaction"
    );
    expect(translatePlural("plurals.transaction_plural", 5, undefined, "en")).toBe(
      "5 transactions"
    );
  });

  it("applies locale plural rules", () => {
    expect(translatePlural("plurals.night_plural", 2, undefined, "de")).toBe("2 Nächte");
    expect(translatePlural("plurals.night_plural", 1, undefined, "de")).toBe("1 Nacht");
  });
});

describe("money formatting", () => {
  it("groups and places the symbol per locale", () => {
    // Non-breaking spaces vary by ICU build, so assert on the parts that matter.
    const en_ = formatCurrency(1234.5, "USD", "en");
    expect(en_).toContain("1,234.50");
    const de_ = formatCurrency(1234.5, "EUR", "de");
    expect(de_).toContain("1.234,50");
  });

  it("uses zero minor units for JPY", () => {
    // ¥1,200.00 is wrong currency, not just odd formatting.
    const out = formatCurrency(1200, "JPY", "ja");
    expect(out).not.toContain(".00");
    expect(out).toContain("1,200");
  });

  it("uses zero minor units for KRW", () => {
    expect(formatCurrency(1200, "KRW", "ko")).not.toContain(".00");
  });

  it("formats a token as a number plus a ticker, not as a currency", () => {
    const out = formatToken(1234.5678, "USDC", 6, "en");
    expect(out).toBe("1,234.5678 USDC");
  });

  it("respects the locale for token grouping too", () => {
    expect(formatToken(1234.5, "USDC", 6, "de")).toBe("1.234,5 USDC");
  });

  it("compacts large numbers", () => {
    expect(formatCompact(1_500_000, "en")).toMatch(/1\.5M/);
  });

  it("formats plain numbers", () => {
    expect(formatNumber(0.5, { style: "percent" }, "en")).toBe("50%");
  });
});

describe("decimal separator handling", () => {
  it("reports the locale separator", () => {
    expect(decimalSeparator("en")).toBe(".");
    expect(decimalSeparator("de")).toBe(",");
    expect(decimalSeparator("fr")).toBe(",");
  });

  it("parses a German-typed amount without multiplying it by 100", () => {
    // The bug this exists to prevent: 1,50 read as 150.
    expect(parseLocaleNumber("1,50", "de")).toBeCloseTo(1.5);
    expect(parseLocaleNumber("1.234,56", "de")).toBeCloseTo(1234.56);
  });

  it("parses an English-typed amount", () => {
    expect(parseLocaleNumber("1,234.56", "en")).toBeCloseTo(1234.56);
  });

  it("returns NaN for junk rather than a wrong number", () => {
    expect(Number.isNaN(parseLocaleNumber("abc", "en"))).toBe(true);
  });
});

describe("resolveLocale", () => {
  it("matches on the primary subtag", () => {
    expect(resolveLocale("pt-BR")).toBe("pt");
    expect(resolveLocale("pt-PT")).toBe("pt");
    expect(resolveLocale("zh-Hant-TW")).toBe("zh");
    expect(resolveLocale("en_US")).toBe("en");
  });

  it("falls back to English for an unsupported language", () => {
    expect(resolveLocale("sw-KE")).toBe("en");
    expect(resolveLocale("")).toBe("en");
  });
});
