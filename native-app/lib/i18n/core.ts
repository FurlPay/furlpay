import { I18nManager, NativeModules, Platform } from "react-native";
import { prefGet, prefSet } from "../db";

// ---------------------------------------------------------------------------
// i18n runtime.
//
// Deliberately not i18next/react-intl. Those bring a plugin architecture, an
// async backend loader and ~40KB of bundle for features this app does not use;
// the whole requirement here is lookup + interpolation + plurals + Intl
// formatting, and Intl is already in the engine. The bundle budget matters —
// see the startup work in this same change.
//
// ON Intl: Hermes ships Intl on Android (backed by ICU via the platform) and on
// iOS. It is NOT guaranteed on every engine/config, so every Intl call here is
// guarded and degrades to an English-ish fallback rather than throwing. A
// missing Intl must never be able to crash a balance.
// ---------------------------------------------------------------------------

export const LOCALES = [
  "en",
  "hi",
  "es",
  "fr",
  "de",
  "pt",
  "ja",
  "ko",
  "zh",
] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  // Endonyms — a language picker that lists "Hindi" to somebody who reads only
  // Hindi has failed at the one job it has.
  en: "English",
  hi: "हिन्दी",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
};

/** BCP-47 tags for Intl. `zh` alone leaves numbering ambiguous on some ICUs. */
const INTL_TAG: Record<Locale, string> = {
  en: "en-US",
  hi: "hi-IN",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-Hans-CN",
};

/**
 * Right-to-left locales.
 *
 * None of the nine launch languages is RTL, so this is empty TODAY — but the
 * plumbing is live (see `isRTL` and the layout direction handling) so that
 * adding Arabic or Hebrew is a catalog file plus one entry here, not a UI
 * rewrite. Everything in the design system already uses `start`/`end`-agnostic
 * flex rather than hardcoded left/right for this reason.
 */
const RTL_LOCALES = new Set<string>(["ar", "he", "fa", "ur"]);

const PREF_KEY = "ui.locale";

// --- device locale ----------------------------------------------------------

/** The device's preferred language tag, e.g. "pt-BR". Best-effort. */
function deviceLanguageTag(): string {
  try {
    if (Platform.OS === "ios") {
      const s = NativeModules.SettingsManager?.settings;
      const tag =
        s?.AppleLocale ??
        (Array.isArray(s?.AppleLanguages) ? s.AppleLanguages[0] : undefined);
      if (typeof tag === "string") return tag;
    } else {
      const tag = NativeModules.I18nManager?.localeIdentifier;
      if (typeof tag === "string") return tag;
    }
  } catch {
    // Fall through — a missing native module must not stop the app.
  }
  return "en";
}

/**
 * Map a device tag onto a supported locale.
 *
 * Matches on the PRIMARY SUBTAG only: "pt-PT" and "pt-BR" both resolve to `pt`,
 * because shipping European Portuguese copy to a Brazilian user is far better
 * than shipping English. Region-specific catalogs can split later without
 * changing any call site.
 */
export function resolveLocale(tag: string): Locale {
  const primary = tag.replace(/_/g, "-").split("-")[0]?.toLowerCase();
  return (LOCALES as readonly string[]).includes(primary ?? "")
    ? (primary as Locale)
    : "en";
}

// --- current locale ---------------------------------------------------------

let current: Locale = (() => {
  const stored = prefGet(PREF_KEY);
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  return resolveLocale(deviceLanguageTag());
})();

const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/** `null` restores "follow the device". */
export function setLocale(next: Locale | null): void {
  if (next === null) {
    prefSet(PREF_KEY, "");
    current = resolveLocale(deviceLanguageTag());
  } else {
    prefSet(PREF_KEY, next);
    current = next;
  }
  formatterCache.clear();
  for (const fn of listeners) fn();
}

/** True when the user pinned a language rather than following the device. */
export function isLocalePinned(): boolean {
  const stored = prefGet(PREF_KEY);
  return !!stored && (LOCALES as readonly string[]).includes(stored);
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isRTL(locale: Locale = current): boolean {
  return RTL_LOCALES.has(locale) || I18nManager.isRTL;
}

// --- interpolation & plurals ------------------------------------------------

export type Vars = Record<string, string | number>;

/**
 * `{name}` substitution.
 *
 * An unknown placeholder is left VERBATIM rather than replaced with "undefined"
 * — if a translator writes `{amout}`, the screen shows `{amout}`, which is
 * visibly a bug in QA instead of the word "undefined" next to a balance.
 */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole
  );
}

export type PluralForm = "zero" | "one" | "two" | "few" | "many" | "other";
export type PluralSet = Partial<Record<PluralForm, string>> & { other: string };

/**
 * Pick a plural form via `Intl.PluralRules`.
 *
 * Not `n === 1 ? a : b`. That rule is wrong for most of the launch set —
 * French treats 0 as singular, Russian has three forms, Japanese/Korean/Chinese
 * have one. Delegating to CLDR is the only way this scales past English.
 */
export function plural(n: number, forms: PluralSet, locale: Locale = current): string {
  let form: PluralForm = "other";
  try {
    form = new Intl.PluralRules(INTL_TAG[locale]).select(n) as PluralForm;
  } catch {
    form = n === 1 ? "one" : "other";
  }
  return forms[form] ?? forms.other;
}

// --- formatters -------------------------------------------------------------
//
// Intl formatter construction is expensive (it parses the locale data), and a
// transaction list builds one per row. Cached per (locale, kind, options).

const formatterCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numberFormat(locale: Locale, opts: Intl.NumberFormatOptions): Intl.NumberFormat | null {
  const key = `n:${locale}:${JSON.stringify(opts)}`;
  const hit = formatterCache.get(key);
  if (hit) return hit as Intl.NumberFormat;
  try {
    const f = new Intl.NumberFormat(INTL_TAG[locale], opts);
    formatterCache.set(key, f);
    return f;
  } catch {
    return null;
  }
}

function dateFormat(locale: Locale, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  const key = `d:${locale}:${JSON.stringify(opts)}`;
  const hit = formatterCache.get(key);
  if (hit) return hit as Intl.DateTimeFormat;
  try {
    const f = new Intl.DateTimeFormat(INTL_TAG[locale], opts);
    formatterCache.set(key, f);
    return f;
  } catch {
    return null;
  }
}

export function formatNumber(
  value: number,
  opts: Intl.NumberFormatOptions = {},
  locale: Locale = current
): string {
  const f = numberFormat(locale, opts);
  if (f) return f.format(value);
  const digits = opts.maximumFractionDigits ?? 2;
  return value.toFixed(digits);
}

/**
 * Money.
 *
 * `currencyDisplay: "narrowSymbol"` so USD reads "$12.00" rather than
 * "US$12.00" in locales whose CLDR data disambiguates by default — the app is
 * already telling the user which account they are looking at.
 *
 * Fraction digits are NOT hardcoded to 2. JPY and KRW have zero minor units, so
 * "¥1,200.00" is wrong currency, not just odd formatting. Intl knows this per
 * currency; the fallback below only guesses when Intl is unavailable.
 */
export function formatCurrency(
  value: number,
  currency = "USD",
  locale: Locale = current,
  opts: Intl.NumberFormatOptions = {}
): string {
  const f = numberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    ...opts,
  });
  if (f) return f.format(value);
  const zeroDecimal = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);
  const digits = zeroDecimal.has(currency) ? 0 : 2;
  return `${value.toFixed(digits)} ${currency}`;
}

/**
 * A crypto amount.
 *
 * Kept apart from `formatCurrency` because a token is not an ISO-4217 currency:
 * Intl would throw on "USDC", decimals run to 18 rather than 2, and the symbol
 * belongs after the number in every locale. Grouping still comes from the
 * locale, so a German user sees `1.234,5678 USDC`.
 */
export function formatToken(
  value: number,
  symbol: string,
  maxDecimals = 6,
  locale: Locale = current
): string {
  const n = formatNumber(
    value,
    { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals },
    locale
  );
  return `${n} ${symbol}`;
}

export function formatPercent(
  fraction: number,
  locale: Locale = current,
  maximumFractionDigits = 2
): string {
  const f = numberFormat(locale, { style: "percent", maximumFractionDigits });
  if (f) return f.format(fraction);
  return `${(fraction * 100).toFixed(maximumFractionDigits)}%`;
}

/**
 * Large numbers, compacted — "1.2M" / "1,2 Mio.".
 *
 * Used for market caps and volumes, never for a balance: a user must be able to
 * read their own money to the cent.
 */
export function formatCompact(value: number, locale: Locale = current): string {
  const f = numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  if (f) return f.format(value);
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

export function formatDate(
  date: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  locale: Locale = current
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const f = dateFormat(locale, opts);
  return f ? f.format(d) : d.toISOString().slice(0, 10);
}

export function formatDateTime(
  date: Date | string | number,
  locale: Locale = current
): string {
  return formatDate(date, { dateStyle: "medium", timeStyle: "short" }, locale);
}

/**
 * "2 hours ago" / "in 3 days".
 *
 * `Intl.RelativeTimeFormat` where available. The threshold ladder is shared by
 * both paths so the wording does not change when Intl is missing — only the
 * language does.
 */
export function formatRelative(
  date: Date | string | number,
  locale: Locale = current,
  now: number = Date.now()
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const deltaSec = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(deltaSec);

  const ladder: [limit: number, unit: Intl.RelativeTimeFormatUnit, div: number][] = [
    [60, "second", 1],
    [3600, "minute", 60],
    [86400, "hour", 3600],
    [604800, "day", 86400],
    [2629800, "week", 604800],
    [31557600, "month", 2629800],
    [Infinity, "year", 31557600],
  ];
  const [, unit, div] = ladder.find(([limit]) => abs < limit)!;
  const value = Math.round(deltaSec / div);

  try {
    return new Intl.RelativeTimeFormat(INTL_TAG[locale], { numeric: "auto" }).format(value, unit);
  } catch {
    const n = Math.abs(value);
    const u = `${unit}${n === 1 ? "" : "s"}`;
    return value < 0 ? `${n} ${u} ago` : `in ${n} ${u}`;
  }
}

/**
 * The locale's decimal separator.
 *
 * An amount keypad has to accept what the user's keyboard actually produces: a
 * German user typing 1,50 into a field that only accepts "." either cannot
 * enter a decimal at all or silently enters 150. Used by FurlAmountInput.
 */
export function decimalSeparator(locale: Locale = current): string {
  const f = numberFormat(locale, {});
  if (!f) return ".";
  const parts = f.formatToParts?.(1.1);
  return parts?.find((p) => p.type === "decimal")?.value ?? ".";
}

/**
 * Normalize user-typed digits to a machine-parseable number.
 *
 * Returns NaN for anything that is not a number. That guard is load-bearing:
 * stripping non-digits from "abc" leaves an EMPTY STRING, and `Number("")` is
 * `0`, not NaN — so without the digit check below, junk in an amount field
 * parses as a perfectly valid zero and every "is this a number?" test upstream
 * passes on it.
 */
export function parseLocaleNumber(input: string, locale: Locale = current): number {
  const sep = decimalSeparator(locale);
  const group = sep === "," ? "." : ",";
  const cleaned = input.split(group).join("").replace(sep, ".").replace(/[^\d.\-]/g, "");
  if (!/\d/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
