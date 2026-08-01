import { describe, it, expect } from "vitest";
import {
  COUNTRIES,
  EXPIRY_WARNING_DAYS,
  countryName,
  getCountry,
  isSupportedCountry,
  maskDocument,
  maskTail,
  searchCountries,
  toTail,
} from "@/lib/passport/documents";
import type { TravelDocument } from "@/lib/passport/documents";

// maskDocument is the ONLY boundary between stored document data and any API
// response. If it leaks, a passport number leaks. These tests are adversarial
// on purpose: they assert what must NOT appear, not just what must.

const doc = (over: Partial<TravelDocument> = {}): TravelDocument => ({
  id: "11111111-1111-1111-1111-111111111111",
  userId: "user_1",
  type: "passport",
  issuingCountry: "GBR",
  documentTail: "6789",
  expiresOn: "2030-01-01T00:00:00.000Z",
  status: "verified",
  verifiedBy: "sumsub",
  verifiedAt: "2026-07-01T00:00:00.000Z",
  chipVerified: true,
  label: "Main passport",
  isPrimary: true,
  createdAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

describe("masking never leaks a document number", () => {
  it("never emits the userId", () => {
    const masked = maskDocument(doc());
    expect(JSON.stringify(masked)).not.toContain("user_1");
  });

  it("emits only the last four characters", () => {
    const masked = maskDocument(doc({ documentTail: "6789" }));
    expect(masked.documentNumberMasked).toBe("•••• 6789");
  });

  it("masks a FULL number if one ever reaches it through an upstream bug", () => {
    // Defence in depth: toTail should have run first. If it did not, this must
    // still not echo the whole number back to a client.
    const masked = maskDocument(doc({ documentTail: "123456789" }));
    expect(masked.documentNumberMasked).toBe("•••• 6789");
    expect(masked.documentNumberMasked).not.toContain("12345");
  });

  it("whitelists fields — an unknown stored field cannot reach the client", () => {
    const withExtra = {
      ...doc(),
      // Exactly the class of field that must never egress.
      mrz: "P<GBRSMITH<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
      faceImageBase64: "iVBORw0KGgo",
    } as unknown as TravelDocument;

    const serialized = JSON.stringify(maskDocument(withExtra));
    expect(serialized).not.toContain("P<GBR");
    expect(serialized).not.toContain("iVBORw0KGgo");
    expect(serialized).not.toContain("mrz");
  });

  it("sends a human type label so the client keeps no copy of the mapping", () => {
    expect(maskDocument(doc({ type: "national_id" })).typeLabel).toBe("National ID");
    expect(maskDocument(doc({ type: "passport" })).typeLabel).toBe("Passport");
  });

  it("produces a stable field set", () => {
    // A new key appearing here should be a deliberate decision, not a surprise.
    expect(Object.keys(maskDocument(doc())).sort()).toEqual(
      [
        "chipVerified",
        "countryName",
        "createdAt",
        "documentNumberMasked",
        "expired",
        "expiresOn",
        "expiringSoon",
        "id",
        "isPrimary",
        "issuingCountry",
        "label",
        "status",
        "type",
        "typeLabel",
        "verifiedAt",
        "verifiedBy",
      ].sort()
    );
  });
});

describe("maskTail / toTail", () => {
  it("reduces a full number to four characters", () => {
    expect(toTail("123456789")).toBe("6789");
    expect(toTail("AB-123 456")).toBe("3456");
  });

  it("uppercases so two renderings of one document match", () => {
    expect(toTail("ab1234cd")).toBe("34CD");
  });

  it("handles a short or empty number without throwing or padding", () => {
    expect(toTail("12")).toBe("12");
    expect(maskTail("12")).toBe("•••• 12");
    expect(maskTail("")).toBe("••••");
  });
});

describe("expiry", () => {
  const now = new Date("2026-07-23T00:00:00.000Z");

  it("flags an expired document and downgrades its verified status", () => {
    const masked = maskDocument(doc({ expiresOn: "2026-01-01T00:00:00.000Z" }), now);
    expect(masked.expired).toBe(true);
    // A user must not see "Verified" on a passport that has run out.
    expect(masked.status).toBe("expired");
  });

  it("warns inside the six-month window many states enforce", () => {
    const soon = new Date(now.getTime() + (EXPIRY_WARNING_DAYS - 10) * 86_400_000);
    const masked = maskDocument(doc({ expiresOn: soon.toISOString() }), now);
    expect(masked.expiringSoon).toBe(true);
    expect(masked.expired).toBe(false);
    expect(masked.status).toBe("verified");
  });

  it("does not warn well outside the window", () => {
    const masked = maskDocument(doc({ expiresOn: "2030-01-01T00:00:00.000Z" }), now);
    expect(masked.expiringSoon).toBe(false);
  });

  it("does not mark a failed document expired-verified", () => {
    const masked = maskDocument(doc({ status: "failed", expiresOn: "2026-01-01" }), now);
    expect(masked.status).toBe("failed");
  });

  it("survives an unparseable expiry rather than throwing", () => {
    const masked = maskDocument(doc({ expiresOn: "not-a-date" }), now);
    expect(masked.expired).toBe(false);
    expect(masked.expiringSoon).toBe(false);
  });
});

describe("country registry", () => {
  it("uses valid ISO 3166-1 shapes throughout", () => {
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.code2).toMatch(/^[A-Z]{2}$/);
      expect(c.name.length).toBeGreaterThan(1);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.code2)).size).toBe(COUNTRIES.length);
  });

  it("claims no chip or protocol capability", () => {
    // Capability is the provider's answer. A stale local map that says a
    // document is readable when it is not strands the user mid-flow.
    for (const c of COUNTRIES) {
      expect(Object.keys(c).sort()).toEqual(["code", "code2", "name", "region"]);
    }
  });

  it("looks up case-insensitively", () => {
    expect(getCountry("gbr")?.name).toBe("United Kingdom");
    expect(isSupportedCountry("ind")).toBe(true);
  });

  it("falls back to the code rather than 'undefined' for an unlisted country", () => {
    expect(countryName("ZZZ")).toBe("ZZZ");
  });

  it("searches by name and either code", () => {
    expect(searchCountries("united").map((c) => c.code)).toContain("USA");
    expect(searchCountries("IND").map((c) => c.code)).toContain("IND");
    expect(searchCountries("de").map((c) => c.code)).toContain("DEU");
  });

  it("returns everything for an empty query", () => {
    expect(searchCountries("  ")).toHaveLength(COUNTRIES.length);
  });
});
