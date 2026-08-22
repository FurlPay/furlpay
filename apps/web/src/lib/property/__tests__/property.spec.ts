import { describe, it, expect } from "vitest";
import { checkUrl, isBlockedAddress } from "../safeFetch";
import { scoreConfidence, explainStatus } from "../confidence";
import {
  isDisallowedAsOfficial,
  nameAppears,
  normalizeText,
  phoneAppears,
  registrationAppears,
} from "../verify";
import {
  allProviders,
  lookupRegistration,
  providerForNumber,
  registryCoverage,
} from "../registry";
import type { Evidence, EvidenceKind, TrustFinding } from "../types";

// ---------------------------------------------------------------------------
// DirectScout property intelligence.
//
// Two things carry this feature's safety, and both are tested here rather than
// assumed:
//
//   1. Every URL is attacker-influenced. A user pastes one, a search suggests
//      one, a registry record carries one. An SSRF hole here reaches the cloud
//      metadata endpoint.
//
//   2. The product hands a user a link and says "this is the official site".
//      A verifier that accepts a lookalike sends someone to a phishing page
//      with FurlPay's endorsement on it.
// ---------------------------------------------------------------------------

describe("SSRF: blocked addresses", () => {
  it("blocks loopback, private and link-local IPv4", () => {
    for (const ip of ["127.0.0.1", "127.1.1.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "0.0.0.0"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks the cloud metadata address specifically", () => {
    // 169.254.169.254 hands out credentials to anything that asks. This is the
    // single most valuable target an SSRF has.
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks CGNAT space", () => {
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
    expect(isBlockedAddress("100.127.255.255")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 — loopback in a v6 costume", () => {
    // A naive check for "127." misses these entirely.
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
  });

  it("blocks IPv6 loopback, link-local, ULA and multicast", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks the NAT64 prefix, which reaches IPv4 space", () => {
    expect(isBlockedAddress("64:ff9b::7f00:1")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("refuses anything that is not an IP at all", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("SSRF: URL checks", () => {
  it("rejects non-http schemes", async () => {
    for (const url of ["file:///etc/passwd", "gopher://x/", "ftp://x/", "data:text/html,hi"]) {
      const r = await checkUrl(url);
      expect(r.ok, url).toBe(false);
      expect(r.reason).toBe("bad_scheme");
    }
  });

  it("rejects localhost by name as well as by address", async () => {
    for (const url of ["http://localhost/", "http://x.localhost/", "http://foo.internal/"]) {
      const r = await checkUrl(url);
      expect(r.ok, url).toBe(false);
      expect(r.reason).toBe("blocked_host");
    }
  });

  it("rejects a literal private IP without a DNS round trip", async () => {
    const r = await checkUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("private_address");
  });

  it("rejects an unparseable URL", async () => {
    expect((await checkUrl("not a url")).ok).toBe(false);
  });

  it("returns the resolved address so the caller connects to what was checked", async () => {
    // The DNS-rebinding defence: validating a hostname and then letting fetch
    // re-resolve it is exactly the hole. The address must come back.
    const r = await checkUrl("http://93.184.216.34/");
    expect(r.ok).toBe(true);
    expect(r.address).toBe("93.184.216.34");
  });
});

describe("domains that can never be 'official'", () => {
  it("refuses OTAs", () => {
    for (const host of ["www.airbnb.com", "airbnb.co.uk", "booking.com", "www.vrbo.com", "expedia.co.in", "www.agoda.com"]) {
      expect(isDisallowedAsOfficial(host), host).toBe(true);
    }
  });

  it("refuses link shorteners, which hide the destination", () => {
    for (const host of ["bit.ly", "tinyurl.com", "t.co"]) {
      expect(isDisallowedAsOfficial(host), host).toBe(true);
    }
  });

  it("allows a genuine property domain", () => {
    for (const host of ["villasonveri.com", "hotel-example.pt", "casa-azul.lodgify.com"]) {
      expect(isDisallowedAsOfficial(host), host).toBe(false);
    }
  });

  it("does not match a domain that merely contains a platform name", () => {
    // "booking" appears in countless legitimate hotel domains.
    expect(isDisallowedAsOfficial("direct-booking-villamar.com")).toBe(false);
    expect(isDisallowedAsOfficial("mybooking.hotel-sol.es")).toBe(false);
  });
});

describe("identity matching", () => {
  it("normalises accents and punctuation", () => {
    expect(normalizeText("Hôtel Sant Jordi — Barcelona")).toBe("hotel sant jordi barcelona");
  });

  it("requires ALL significant name tokens, not a substring", () => {
    // The lookalike defence: "Serena Apartments" must not match "Villa Serena".
    expect(nameAppears("Welcome to Villa Serena, Mallorca", "Villa Serena")).toBe(true);
    expect(nameAppears("Welcome to Serena Apartments", "Villa Serena")).toBe(false);
  });

  it("ignores short filler tokens", () => {
    // Without this, "casa" or "hotel" alone would match half the web.
    expect(nameAppears("Casa Blanca Retreat", "Casa Blanca")).toBe(true);
    expect(nameAppears("Some unrelated page", "The Inn")).toBe(false);
  });

  it("matches a phone number across formatting", () => {
    expect(phoneAppears("Call us on +351 291 234 567 today", "+351291234567")).toBe(true);
    expect(phoneAppears("Call 291-234-567", "351 291 234 567")).toBe(true);
    expect(phoneAppears("Call 999 111 222", "351291234567")).toBe(false);
  });

  it("matches a registration number across separators", () => {
    expect(registrationAppears("Licence ETV/1234 displayed", "ETV-1234")).toBe(true);
    expect(registrationAppears("Reg. no. 12345 / AL", "12345/AL")).toBe(true);
    expect(registrationAppears("Licence ETV/9999", "ETV/1234")).toBe(false);
  });
});

describe("registry providers", () => {
  it("routes a Portuguese number to RNAL", () => {
    const p = providerForNumber("12345/AL");
    expect(p?.id).toBe("pt-rnal");
    expect(p?.normalize("12345 / al")).toBe("12345/AL");
  });

  it("routes a Catalan HUT to the Generalitat, not the Spanish national provider", () => {
    // Both match the shape; the more specific authority is the right answer.
    const p = providerForNumber("HUTB-012345");
    expect(p?.id).toBe("es-cat-hut");
  });

  it("routes Balearic and Andalusian numbers to Spain", () => {
    expect(providerForNumber("ETV/1234")?.id).toBe("es-vud");
    expect(providerForNumber("VFT/MA/12345")?.id).toBe("es-vud");
  });

  it("routes a 13-digit French code", () => {
    expect(providerForNumber("1234567890123")?.id).toBe("fr-commune");
  });

  it("returns null for an unrecognised format rather than guessing", () => {
    expect(providerForNumber("banana")).toBeNull();
    expect(providerForNumber("")).toBeNull();
  });

  it("reports UNSUPPORTED, not NOT_FOUND, for an unrecognised number", async () => {
    // The distinction that keeps this product honest: we do not know the
    // number is wrong, only that no adapter claims it.
    const { outcome } = await lookupRegistration("XYZ-999");
    expect(outcome.result).toBe("unsupported");
  });

  it("reports UNSUPPORTED for a real jurisdiction with no public lookup", async () => {
    const { provider, outcome } = await lookupRegistration("HUTB-012345");
    expect(provider?.queryable).toBe(false);
    expect(outcome.result).toBe("unsupported");
  });

  it("gives every provider a public URL a person can check themselves", () => {
    for (const p of allProviders()) {
      expect(p.publicUrl, p.id).toMatch(/^https:\/\//);
      expect(p.authority.length).toBeGreaterThan(5);
    }
  });

  it("publishes coverage so the UI can set expectations before searching", () => {
    const coverage = registryCoverage();
    expect(coverage.length).toBeGreaterThan(0);
    // Portugal's register genuinely is public and searchable.
    expect(coverage.find((c) => c.country === "PT")?.queryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------

function ev(kind: EvidenceKind, supports = true): Evidence {
  return {
    kind, supports,
    source: "test", sourceUrl: "https://example.com",
    retrievedAt: "2026-08-22T00:00:00.000Z", detail: kind,
  };
}

describe("confidence", () => {
  it("scores zero with no evidence, and does not invent a number", () => {
    const r = scoreConfidence([], []);
    expect(r.score).toBe(0);
    expect(r.status).toBe("NOT_FOUND");
  });

  it("reaches VERIFIED only with a registry match AND a site tied to it", () => {
    const registryOnly = scoreConfidence([ev("registry_match"), ev("registry_status_active")], []);
    expect(registryOnly.status).toBe("PARTIALLY_VERIFIED");

    const full = scoreConfidence(
      [ev("registry_match"), ev("registry_status_active"), ev("domain_in_registry"), ev("name_match_on_site")],
      []
    );
    expect(full.status).toBe("VERIFIED");
    expect(full.score).toBeGreaterThanOrEqual(60);
  });

  it("cannot reach VERIFIED on corroboration alone, however much of it there is", () => {
    // The anti-lookalike rule, structural rather than a threshold: a scam page
    // can produce every one of these signals.
    const r = scoreConfidence(
      [
        ev("name_match_on_site"), ev("address_match_on_site"), ev("phone_match_on_site"),
        ev("structured_data"), ev("booking_engine_detected"), ev("tls_valid"), ev("domain_age"),
      ],
      []
    );
    expect(r.status).not.toBe("VERIFIED");
    expect(r.status).toBe("UNVERIFIED");
  });

  it("treats the licence on the site as a site-tying signal", () => {
    // A registry hit carries its status, so the realistic chain is
    // match + active + licence = 35 + 10 + 15 = 60, exactly the threshold.
    const r = scoreConfidence(
      [ev("registry_match"), ev("registry_status_active"), ev("license_on_site")],
      []
    );
    expect(r.status).toBe("VERIFIED");
  });

  it("holds the licence path just short of VERIFIED without a confirmed status", () => {
    // 35 + 15 = 50. Deliberate: a licence number can be copied onto a fake
    // site, so that path needs the registry to also confirm the registration
    // is CURRENT before the product says "verified". The registry-published
    // domain is the stronger anchor and does not need the extra corroboration.
    const r = scoreConfidence([ev("registry_match"), ev("license_on_site")], []);
    expect(r.status).toBe("PARTIALLY_VERIFIED");
    expect(r.score).toBe(50);
  });

  it("subtracts for contradictory evidence", () => {
    const good = scoreConfidence([ev("registry_match"), ev("address_match_on_site")], []);
    const bad = scoreConfidence([ev("registry_match"), ev("address_match_on_site", false)], []);
    expect(bad.score).toBeLessThan(good.score);
  });

  it("caps at PARTIALLY_VERIFIED on any critical finding", () => {
    const findings: TrustFinding[] = [
      { signal: "domain_mismatch", severity: "critical", detail: "registry names a different domain" },
    ];
    const r = scoreConfidence(
      [ev("registry_match"), ev("registry_status_active"), ev("domain_in_registry"), ev("license_on_site")],
      findings
    );
    expect(r.status).toBe("PARTIALLY_VERIFIED");
  });

  it("returns NOT_FOUND when the registry actively contradicts", () => {
    const r = scoreConfidence([ev("registry_match", false)], []);
    expect(r.status).toBe("NOT_FOUND");
  });

  it("does not double-count a repeated signal", () => {
    const once = scoreConfidence([ev("name_match_on_site")], []);
    const thrice = scoreConfidence([ev("name_match_on_site"), ev("name_match_on_site"), ev("name_match_on_site")], []);
    expect(thrice.score).toBe(once.score);
  });

  it("lets a contradiction beat a confirmation of the same kind", () => {
    const mixed = scoreConfidence([ev("address_match_on_site"), ev("address_match_on_site", false)], []);
    expect(mixed.score).toBeLessThan(scoreConfidence([ev("address_match_on_site")], []).score);
  });

  it("stays inside 0-100", () => {
    const everything = (Object.keys({
      registry_match: 0, registry_status_active: 0, domain_in_registry: 0, license_on_site: 0,
      structured_data: 0, booking_engine_detected: 0, name_match_on_site: 0,
      address_match_on_site: 0, phone_match_on_site: 0, domain_age: 0, tls_valid: 0,
    }) as EvidenceKind[]).map((k) => ev(k));
    expect(scoreConfidence(everything, []).score).toBeLessThanOrEqual(100);

    const awful: TrustFinding[] = Array.from({ length: 20 }, () => ({
      signal: "domain_mismatch" as const, severity: "critical" as const, detail: "bad",
    }));
    expect(scoreConfidence([], awful).score).toBe(0);
  });

  it("explains every status in words a reader can act on", () => {
    for (const s of ["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED", "NOT_FOUND"] as const) {
      expect(explainStatus(s).length).toBeGreaterThan(40);
    }
    // NOT_FOUND must not read as an accusation.
    expect(explainStatus("NOT_FOUND")).toMatch(/not evidence of a problem/i);
    expect(explainStatus("UNVERIFIED")).toMatch(/not a warning/i);
  });

  it("is deterministic — the same evidence always gives the same score", () => {
    const e = [ev("registry_match"), ev("domain_in_registry"), ev("name_match_on_site")];
    const a = scoreConfidence(e, []);
    const b = scoreConfidence(e, []);
    expect(a.score).toBe(b.score);
    expect(a.status).toBe(b.status);
  });
});
