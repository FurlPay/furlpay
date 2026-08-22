// ---------------------------------------------------------------------------
// Registry providers, one per jurisdiction.
//
// SHORT-TERM RENTAL REGISTRATION IS NOT ONE SYSTEM. It is dozens, with
// different authorities, number formats, and — critically — different answers
// to "can the public query it at all". Portugal publishes a free searchable
// national register. Spain registers by autonomous community under RD
// 1312/2024, so a Spanish property has a regional number and there is no single
// national lookup. Most of the world has nothing.
//
// So the interface below has THREE outcomes, not two: found, not found, and
// `unsupported` — meaning we have no way to ask. Collapsing the third into
// "not found" would report every property in an unregistered jurisdiction as
// unverifiable-and-therefore-doubtful, which describes most legitimate hosts
// on earth.
//
// ADAPTERS ARE HONEST ABOUT WHAT THEY IMPLEMENT. A provider that has a
// documented public search implements `lookup`. A provider whose registry is
// real but has no public query interface declares itself and returns
// `unsupported` — it exists so the jurisdiction is RECOGNISED (the number
// format can still be validated, which is genuinely useful) without pretending
// we can confirm it.
// ---------------------------------------------------------------------------

import type { Jurisdiction, Registration } from "../types";

export type RegistryOutcome =
  | { result: "found"; registration: Registration; sourceUrl: string; retrievedAt: string }
  | { result: "not_found"; sourceUrl: string; retrievedAt: string; detail: string }
  | { result: "unsupported"; detail: string }
  | { result: "error"; detail: string };

export interface RegistryProvider {
  /** Stable id, e.g. "pt-rnal". */
  readonly id: string;
  /** The authority, as it should be shown to a reader. */
  readonly authority: string;
  readonly jurisdiction: Jurisdiction;
  /** Whether this provider can actually query anything. */
  readonly queryable: boolean;
  /** Public URL a person can check the answer at themselves. */
  readonly publicUrl: string;

  /** Does this registration number look like one this authority issues? */
  matchesFormat(registrationNumber: string): boolean;
  /** Normalise to the authority's canonical spelling. */
  normalize(registrationNumber: string): string;
  /** Look the number up. Providers that cannot return `unsupported`. */
  lookup(registrationNumber: string): Promise<RegistryOutcome>;
}

/**
 * Portugal — Registo Nacional de Alojamento Local (RNAL).
 *
 * Turismo de Portugal publishes a free public search at
 * rnt.turismodeportugal.pt. Numbers are `12345/AL`, and the registration is
 * the legal title to operate — a property advertising without one is not
 * lawfully operating, which makes a missing record here meaningful in a way it
 * is not elsewhere.
 *
 * `queryable` is true because the search genuinely exists and is public. The
 * lookup is NOT implemented against it yet: the page is a stateful ASP.NET
 * form (postback tokens, no documented JSON endpoint), so a correct client is
 * real work rather than a fetch, and shipping a half-working one would produce
 * false NOT_FOUNDs on legitimate properties. It returns `unsupported` with
 * that reason until the client exists.
 */
class PortugalRnalProvider implements RegistryProvider {
  readonly id = "pt-rnal";
  readonly authority = "Turismo de Portugal — Registo Nacional de Alojamento Local";
  readonly jurisdiction: Jurisdiction = { country: "PT" };
  readonly queryable = true;
  readonly publicUrl = "https://rnt.turismodeportugal.pt/RNT/Pesquisa_AL.aspx";

  matchesFormat(n: string): boolean {
    return /^\d{1,7}\s*\/\s*AL$/i.test(n.trim());
  }

  normalize(n: string): string {
    const digits = n.trim().replace(/\s*\/\s*AL$/i, "").trim();
    return `${digits}/AL`;
  }

  async lookup(registrationNumber: string): Promise<RegistryOutcome> {
    return {
      result: "unsupported",
      detail:
        `RNAL publishes a free public search at ${this.publicUrl}, but it is a stateful ASP.NET ` +
        "form with no documented JSON endpoint. A correct client is outstanding work; until it " +
        `exists we validate the ${this.normalize(registrationNumber)} format and link the reader ` +
        "to the official search rather than returning a result we cannot stand behind.",
    };
  }
}

/**
 * Spain — Registro Único de Arrendamientos (RD 1312/2024).
 *
 * In force since 1 July 2025: every short-term rental advertised on a platform
 * must carry a registration number, obtained via the Ventanilla Única Digital.
 * The national number coexists with the older regional codes, which are still
 * what most listings display.
 *
 * NOT queryable. The Ventanilla Única is a filing system for owners and
 * platforms; there is no public lookup a third party can call. This provider
 * exists to recognise Spanish numbers and validate their shape, which is
 * genuinely useful — a malformed licence is a real signal — without implying we
 * confirmed anything.
 */
class SpainNationalProvider implements RegistryProvider {
  readonly id = "es-vud";
  readonly authority = "Ministerio de Vivienda — Ventanilla Única Digital de Arrendamientos";
  readonly jurisdiction: Jurisdiction = { country: "ES" };
  readonly queryable = false;
  readonly publicUrl =
    "https://www.mivau.gob.es/vivienda/ventanilla-unica/alquiler-de-alojamientos-de-corta-duracion";

  matchesFormat(n: string): boolean {
    // Regional formats still in circulation. Recognising them is the point;
    // each is issued by a different autonomous community.
    return (
      /^ETV[PL]*\s*[\/-]\s*\d{1,6}$/i.test(n.trim()) || // Balearics
      /^HUT[A-Z]?\s*-\s*\d{5,6}$/i.test(n.trim()) || // Catalonia
      /^VFT\s*\/\s*[A-Z]{2}\s*\/\s*\d{1,6}$/i.test(n.trim()) || // Andalucía
      /^VT\s*-\s*\d{1,6}\s*-\s*[A-Z]$/i.test(n.trim()) // Valencia
    );
  }

  normalize(n: string): string {
    return n.trim().toUpperCase().replace(/\s+/g, "");
  }

  async lookup(): Promise<RegistryOutcome> {
    return {
      result: "unsupported",
      detail:
        "Spain registers short-term rentals through the Ventanilla Única Digital and the " +
        "autonomous communities. Neither publishes a third-party lookup API, so the number's " +
        "format can be validated but its existence cannot be confirmed from here.",
    };
  }
}

/**
 * Catalonia — Registre de Turisme de Catalunya (HUT).
 *
 * Separate from the Spanish national provider because the number is issued by
 * the Generalitat and follows its own scheme (HUTB for Barcelona, HUTG for
 * Girona, and so on by province).
 */
class CataloniaHutProvider implements RegistryProvider {
  readonly id = "es-cat-hut";
  readonly authority = "Generalitat de Catalunya — Registre de Turisme de Catalunya";
  readonly jurisdiction: Jurisdiction = { country: "ES", region: "CT" };
  readonly queryable = false;
  readonly publicUrl = "https://empresa.gencat.cat/ca/treb_ambits_actuacio/emo_turisme/";

  matchesFormat(n: string): boolean {
    return /^HUT[BGLT]?\s*-?\s*\d{5,6}$/i.test(n.trim());
  }

  normalize(n: string): string {
    const m = /^(HUT[BGLT]?)\s*-?\s*(\d{5,6})$/i.exec(n.trim());
    return m ? `${m[1].toUpperCase()}-${m[2]}` : n.trim().toUpperCase();
  }

  async lookup(): Promise<RegistryOutcome> {
    return {
      result: "unsupported",
      detail:
        "The Catalan tourism register does not expose a public query API. The HUT number's " +
        "format is validated; its existence is not confirmed from here.",
    };
  }
}

/**
 * France — numéro d'enregistrement.
 *
 * A 13-digit code issued by the commune, not nationally. There are thousands of
 * issuing municipalities and no central register, so format validation is all
 * that is available.
 */
class FranceProvider implements RegistryProvider {
  readonly id = "fr-commune";
  readonly authority = "Numéro d'enregistrement communal";
  readonly jurisdiction: Jurisdiction = { country: "FR" };
  readonly queryable = false;
  readonly publicUrl = "https://www.service-public.fr/particuliers/vosdroits/F2043";

  matchesFormat(n: string): boolean {
    return /^\d{13}$/.test(n.trim().replace(/[\s-]/g, ""));
  }

  normalize(n: string): string {
    return n.trim().replace(/[\s-]/g, "");
  }

  async lookup(): Promise<RegistryOutcome> {
    return {
      result: "unsupported",
      detail:
        "French registration numbers are issued by individual communes with no central public " +
        "register, so only the 13-digit format can be checked.",
    };
  }
}

const PROVIDERS: RegistryProvider[] = [
  new PortugalRnalProvider(),
  new CataloniaHutProvider(),
  new SpainNationalProvider(),
  new FranceProvider(),
];

export function allProviders(): RegistryProvider[] {
  return [...PROVIDERS];
}

/**
 * Which authority issues a number of this shape?
 *
 * Catalonia is checked before the Spanish national provider because HUT
 * matches both and the more specific authority is the correct answer.
 */
export function providerForNumber(registrationNumber: string): RegistryProvider | null {
  const trimmed = registrationNumber.trim();
  if (!trimmed) return null;
  return PROVIDERS.find((p) => p.matchesFormat(trimmed)) ?? null;
}

export function providersForCountry(country: string): RegistryProvider[] {
  const cc = country.trim().toUpperCase();
  return PROVIDERS.filter((p) => p.jurisdiction.country === cc);
}

/**
 * Look a registration number up with whichever authority issues it.
 *
 * An unrecognised format returns `unsupported`, not `not_found`: we do not know
 * that the number is wrong, only that no adapter here claims it.
 */
export async function lookupRegistration(registrationNumber: string): Promise<{
  provider: RegistryProvider | null;
  outcome: RegistryOutcome;
}> {
  const provider = providerForNumber(registrationNumber);
  if (!provider) {
    return {
      provider: null,
      outcome: {
        result: "unsupported",
        detail:
          "No registry adapter recognises this number's format. It may still be valid — most " +
          "jurisdictions have no public register, and many issue formats we do not model yet.",
      },
    };
  }
  try {
    return { provider, outcome: await provider.lookup(provider.normalize(registrationNumber)) };
  } catch (e) {
    return {
      provider,
      outcome: { result: "error", detail: e instanceof Error ? e.message : "Registry lookup failed." },
    };
  }
}

/** Coverage, for the UI to set expectations honestly before a user searches. */
export function registryCoverage(): {
  country: string;
  region?: string;
  authority: string;
  queryable: boolean;
  publicUrl: string;
}[] {
  return PROVIDERS.map((p) => ({
    country: p.jurisdiction.country,
    region: p.jurisdiction.region,
    authority: p.authority,
    queryable: p.queryable,
    publicUrl: p.publicUrl,
  }));
}
