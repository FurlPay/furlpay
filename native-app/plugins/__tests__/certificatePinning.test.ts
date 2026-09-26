/* eslint-disable @typescript-eslint/no-var-requires */
const android = require("../withNetworkSecurityConfig");
const ios = require("../withIosCertificatePinning");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// The AWS migration blocker, as a test.
//
// The pin set matches `furlpay.com` with includeSubdomains, so it ALREADY
// covers api.furlpay.com, api-staging.furlpay.com and api-dev.furlpay.com. AWS
// Certificate Manager issues certificates chaining to Amazon Trust Services,
// not to ISRG — so an app carrying only the Let's Encrypt anchors fails every
// TLS handshake against an AWS endpoint and reports it to the user as "no
// internet".
//
// Nothing else catches this. The existing expiry gate checks that the pins have
// not LAPSED; these pins are perfectly valid, they simply do not appear in the
// new chain. There is no build error, no lint warning, and no runtime log that
// names the real cause.
//
// Every value asserted here was recomputed from the published root certificate
// on 2026-09-25 with:
//
//   openssl x509 -in <root>.pem -pubkey -noout \
//     | openssl pkey -pubin -outform der \
//     | openssl dgst -sha256 -binary | openssl enc -base64
//
// The Amazon values additionally match the hex digests AWS publishes, which is
// a second independent source. Do not edit a pin here to make a test pass —
// re-run the command against the certificate.
// ---------------------------------------------------------------------------

/** Let's Encrypt — the hosts Vercel serves. */
const ISRG = {
  "ISRG Root YR (RSA, gen-Y)": "fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88=",
  "ISRG Root YE (EC, gen-Y)": "sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=",
  "ISRG Root X1 (RSA)": "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=",
  "ISRG Root X2 (EC)": "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=",
};

/** Amazon Trust Services — the ACM certificates CloudFront serves. */
const AMAZON = {
  "Amazon Root CA 1": "++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=",
  "Amazon Root CA 2": "f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=",
  "Amazon Root CA 3": "NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=",
  "Amazon Root CA 4": "9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=",
  "Starfield Services Root CA G2": "KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=",
};

describe("Android — both CA hierarchies are pinned", () => {
  it.each(Object.entries(ISRG))("release config pins %s", (_name, pin) => {
    expect(android.NETWORK_SECURITY_CONFIG).toContain(pin);
  });

  it.each(Object.entries(AMAZON))("release config pins %s", (_name, pin) => {
    expect(android.NETWORK_SECURITY_CONFIG).toContain(pin);
  });

  it("the debug config pins EXACTLY the same anchors as release", () => {
    // A debug build whose pins differ from release cannot reproduce a
    // release-only TLS failure, which is the one thing you would reach for a
    // debug build to do.
    for (const pin of [...Object.values(ISRG), ...Object.values(AMAZON)]) {
      expect(android.NETWORK_SECURITY_CONFIG_DEBUG).toContain(pin);
    }
  });

  it("refuses to build when an Amazon anchor is missing", () => {
    const stripped = android.NETWORK_SECURITY_CONFIG.replace(AMAZON["Amazon Root CA 1"], "");
    expect(() => android.assertAmazonRootsPinned(stripped)).toThrow(/Amazon Trust Services/);
  });

  it("accepts the shipped config", () => {
    expect(android.assertAmazonRootsPinned()).toBe(true);
  });
});

describe("iOS — both CA hierarchies are pinned", () => {
  it("pins every Let's Encrypt anchor", () => {
    expect(new Set(ios.ISRG_PINS)).toEqual(new Set(Object.values(ISRG)));
  });

  it("pins every Amazon Trust Services anchor", () => {
    expect(new Set(ios.AMAZON_PINS)).toEqual(new Set(Object.values(AMAZON)));
  });

  it("refuses a config missing the Amazon hierarchy", () => {
    expect(() => ios.assertBothHierarchiesPinned(ios.ISRG_PINS)).toThrow(
      /Amazon Trust Services/
    );
  });

  it("refuses a config missing the Let's Encrypt hierarchy", () => {
    // Symmetry matters: dropping ISRG breaks furlpay.com itself, which during a
    // phased cutover is still where most traffic goes.
    expect(() => ios.assertBothHierarchiesPinned(ios.AMAZON_PINS)).toThrow(
      /Let's Encrypt/
    );
  });
});

describe("all four surfaces pin the same anchors", () => {
  // FOUR implementations of one policy. A hostname pinned differently per
  // surface is a cutover that half-breaks — and the half that breaks is
  // whichever one nobody tested first.
  //
  // This used to assert only the two reachable from JS and name the other two
  // in a comment, which left the Kotlin and Swift lists free to drift silently:
  // exactly the failure the shared-constant refactor existed to prevent. They
  // are now read off disk and compared by value. A regex over source is cruder
  // than importing a module, but the alternative is no assertion at all until
  // someone runs a Gradle build and an Xcode build in the same CI job.
  const EXPECTED = new Set([...Object.values(ISRG), ...Object.values(AMAZON)]);

  /** Every base64 SPKI digest in a file, `sha256/` prefix optional. */
  function pinsIn(relPath: string): Set<string> {
    const abs = path.join(__dirname, "..", "..", "..", relPath);
    const src = fs.readFileSync(abs, "utf8");
    const found = src.match(/[A-Za-z0-9+/]{43}=/g) ?? [];
    return new Set(found);
  }

  const androidPins = new Set(
    [...EXPECTED].filter((p) => android.NETWORK_SECURITY_CONFIG.includes(p))
  );

  it("the React Native iOS list is exactly the React Native Android list", () => {
    expect(new Set([...ios.ISRG_PINS, ...ios.AMAZON_PINS])).toEqual(androidPins);
  });

  it("Guardian's Kotlin CertificatePinner pins the same set", () => {
    expect(
      pinsIn(
        "guardian/core/network/src/main/kotlin/com/furlpay/guardian/network/FurlPayPinning.kt"
      )
    ).toEqual(EXPECTED);
  });

  it("the iOS Guardian's Swift CertificatePinner pins the same set", () => {
    expect(
      pinsIn("ios/FurlPayGuardian/Shared/Network/CertificatePinner.swift")
    ).toEqual(EXPECTED);
  });

  it("and the React Native pair agrees with that same set", () => {
    // Ties the two JS-reachable surfaces to the same constant the native two
    // are checked against, so all four are pinned to one list rather than to
    // each other pairwise.
    expect(androidPins).toEqual(EXPECTED);
  });
});
