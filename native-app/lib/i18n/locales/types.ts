import type { Catalog } from "./en";

/**
 * The English catalog is declared `as const`, so every value has a LITERAL type
 * ("Cancel", not string). A translation assigned directly to `Catalog` would
 * therefore have to spell "Cancel" in English to typecheck.
 *
 * `Translation` widens the leaves to `string` while keeping the KEY structure
 * exact. The result is what we want from a translation file: a missing key, an
 * extra key or a typo'd key is a compile error, and the text itself is free.
 */
export type Translation = {
  readonly [K in keyof Catalog]: Catalog[K] extends string
    ? string
    : {
        readonly [K2 in keyof Catalog[K]]: Catalog[K][K2] extends string
          ? string
          : { readonly [K3 in keyof Catalog[K][K2]]: string };
      };
};
