import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  formatToken,
  getLocale,
  interpolate,
  isLocalePinned,
  isRTL,
  plural,
  setLocale,
  subscribeLocale,
  type Locale,
  type PluralSet,
  type Vars,
} from "./core";
import { en, type Catalog } from "./locales/en";
import { hi } from "./locales/hi";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { pt } from "./locales/pt";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { zh } from "./locales/zh";
import type { Translation } from "./locales/types";

export * from "./core";

/**
 * Catalogs are imported statically, not lazily.
 *
 * Nine catalogs is a few KB of the bundle, and the alternative — an async
 * import on first render — means the very first frame of every screen renders
 * either English or blanks and then snaps to the real language. On a login
 * screen that flash is the user's first impression of the app.
 */
const CATALOGS: Record<Locale, Translation> = { en, hi, es, fr, de, pt, ja, ko, zh };

// --- typed key paths --------------------------------------------------------

type StringLeaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends Record<string, unknown>
      ? StringLeaves<T[K], `${P}${K}.`>
      : never;
}[keyof T & string];

/** Every dot-path in the catalog that resolves to a plain string. */
export type TKey = StringLeaves<Catalog>;

/** Every dot-path that resolves to a CLDR plural set. */
export type TPluralKey = `plurals.${keyof Catalog["plurals"] & string}`;

function lookup(catalog: unknown, path: string): unknown {
  let node: unknown = catalog;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * Resolve a key, falling back to English and then to the key itself.
 *
 * The key-as-last-resort matters: a screen that renders `money.balance` is
 * obviously broken to anyone looking at it, whereas an empty string just looks
 * like a layout bug and can ship unnoticed.
 */
function resolve(locale: Locale, key: string): unknown {
  const hit = lookup(CATALOGS[locale], key);
  if (hit !== undefined) return hit;
  if (locale !== "en") {
    const fallback = lookup(en, key);
    if (fallback !== undefined) return fallback;
  }
  return undefined;
}

export function translate(key: TKey, vars?: Vars, locale: Locale = getLocale()): string {
  const value = resolve(locale, key);
  if (typeof value !== "string") return key;
  return interpolate(value, vars);
}

/**
 * Pluralized lookup. `count` is passed to the CLDR rules AND made available to
 * the template as `{count}`, so a catalog entry never has to repeat it.
 */
export function translatePlural(
  key: TPluralKey,
  count: number,
  vars?: Vars,
  locale: Locale = getLocale()
): string {
  const set = resolve(locale, key);
  if (typeof set !== "object" || set === null || !("other" in (set as object))) return key;
  const form = plural(count, set as PluralSet, locale);
  return interpolate(form, { count, ...vars });
}

// --- React binding ----------------------------------------------------------

function subscribe(cb: () => void) {
  return subscribeLocale(cb);
}

/**
 * The hook every screen uses.
 *
 * Backed by `useSyncExternalStore` rather than context: the locale lives in a
 * module-level store so that non-React code (a notification formatter, an error
 * mapper) can call `translate()` directly, and both paths stay in sync. A
 * context would have forced every such caller to be a component.
 */
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);

  const t = useCallback(
    (key: TKey, vars?: Vars) => translate(key, vars, locale),
    [locale]
  );
  const tp = useCallback(
    (key: TPluralKey, count: number, vars?: Vars) => translatePlural(key, count, vars, locale),
    [locale]
  );

  return useMemo(
    () => ({
      locale,
      setLocale,
      isPinned: isLocalePinned(),
      rtl: isRTL(locale),
      t,
      tp,
      // Formatters bound to the current locale so a screen never has to pass it.
      formatCurrency: (v: number, currency?: string, opts?: Intl.NumberFormatOptions) =>
        formatCurrency(v, currency, locale, opts),
      formatToken: (v: number, symbol: string, maxDecimals?: number) =>
        formatToken(v, symbol, maxDecimals, locale),
      formatNumber: (v: number, opts?: Intl.NumberFormatOptions) => formatNumber(v, opts, locale),
      formatPercent: (v: number, digits?: number) => formatPercent(v, locale, digits),
      formatCompact: (v: number) => formatCompact(v, locale),
      formatDate: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) =>
        formatDate(d, opts, locale),
      formatDateTime: (d: Date | string | number) => formatDateTime(d, locale),
      formatRelative: (d: Date | string | number) => formatRelative(d, locale),
    }),
    [locale, t, tp]
  );
}
