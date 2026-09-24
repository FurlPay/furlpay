const { withInfoPlist } = require("expo/config-plugins");

// ---------------------------------------------------------------------------
// Certificate pinning for furlpay.com on iOS.
//
// THE GAP THIS CLOSES
//
// withNetworkSecurityConfig.js pins the Android build. The iOS build of the
// SAME app had no pinning at all — App Transport Security enforces TLS, but not
// WHICH certificate authority signed it. Every CA in the system trust store was
// accepted, which is exactly what an enterprise MDM profile or a user-installed
// root defeats. Same app, same session token, same money, half the protection.
//
// WHY NSPinnedDomains AND NOT A LIBRARY
//
// The app authenticates with `fetch`, which on iOS is NSURLSession underneath
// with no delegate reachable from JavaScript. The usual answer is a native
// pinning library (react-native-ssl-pinning and friends), which means a new
// dependency on the money path, a second HTTP client to keep in step with
// lib/api.ts, and a rewrite of every call site.
//
// NSPinnedDomains (iOS 14+) is Apple's own mechanism and applies to ALL
// NSURLSession traffic in the process — `fetch`, image loads, everything —
// without touching a single line of application code. It is declarative, it
// cannot be bypassed by a mistake in a call site, and it ships no new code.
//
// PIN CHOICE — CA identities, not leaf identities
//
// NSPinnedCAIdentities rather than NSPinnedLeafIdentities, for the same reason
// the Android config pins roots: Vercel rotates the leaf every ~90 days, and a
// pinned leaf turns a routine rotation into a total outage that cannot be fixed
// remotely because the app is already on the user's phone.
//
// BOTH CA HIERARCHIES, because *.furlpay.com is served by Vercel (Let's
// Encrypt) today and by CloudFront + ACM (Amazon Trust Services) in the new AWS
// environments. Pinning one set makes the cutover a total outage on the other
// side, presenting as "no connectivity" rather than as a TLS error.
//
// Values are identical to withNetworkSecurityConfig.js, guardian's
// FurlPayPinning.kt and the Swift CertificatePinner — four implementations, one
// set of anchors, recomputed from the published roots on 2026-09-25:
//
//   openssl x509 -in <root>.pem -pubkey -noout \
//     | openssl pkey -pubin -outform der \
//     | openssl dgst -sha256 -binary | openssl enc -base64
//
// A NOTE ON THE FAILURE MODE
//
// Unlike Android's <pin-set expiration>, NSPinnedDomains has no dead-man's
// switch: stale pins fail closed, permanently, for everyone. That is why the
// list below carries ALL of both CAs' roots rather than only the ones currently
// in use, and why `assertBothHierarchiesPinned` runs at build time.
// ---------------------------------------------------------------------------

/** Let's Encrypt — the hosts Vercel serves. */
const ISRG_PINS = [
  "fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88=", // ISRG Root YR (RSA, gen-Y)
  "sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=", // ISRG Root YE (EC, gen-Y)
  "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=", // ISRG Root X1 (RSA)
  "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=", // ISRG Root X2 (EC)
];

/** Amazon Trust Services — the ACM certificates CloudFront serves. */
const AMAZON_PINS = [
  "++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=", // Amazon Root CA 1
  "f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=", // Amazon Root CA 2
  "NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=", // Amazon Root CA 3
  "9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=", // Amazon Root CA 4
  "KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=", // Starfield Services Root CA G2
];

/** Bump when any pin is added, removed, or re-verified against the source. */
const PINS_VERIFIED_ON = "2026-09-25";

/**
 * Refuse to build a config missing either CA hierarchy.
 *
 * Neither omission produces an error at build time on its own — it produces an
 * app that cannot reach half its backends and reports it as a network failure.
 * Dropping the Amazon roots breaks every AWS environment; dropping the ISRG
 * roots breaks furlpay.com itself.
 */
function assertBothHierarchiesPinned(pins) {
  const missingIsrg = ISRG_PINS.filter((p) => !pins.includes(p));
  const missingAmazon = AMAZON_PINS.filter((p) => !pins.includes(p));
  if (missingIsrg.length || missingAmazon.length) {
    throw new Error(
      "iOS NSPinnedDomains is missing trust anchors:\n" +
        (missingIsrg.length ? `  Let's Encrypt: ${missingIsrg.join(", ")}\n` : "") +
        (missingAmazon.length ? `  Amazon Trust Services: ${missingAmazon.join(", ")}\n` : "") +
        "Both hierarchies are required — furlpay.com is Vercel-served (ISRG) and the\n" +
        "AWS API hosts are CloudFront + ACM (Amazon). Pinning one breaks the other."
    );
  }
  return true;
}

function withIosCertificatePinning(config) {
  return withInfoPlist(config, (cfg) => {
    const pins = [...ISRG_PINS, ...AMAZON_PINS];
    assertBothHierarchiesPinned(pins);

    const ats = cfg.modResults.NSAppTransportSecurity ?? {};

    // NSIncludesSubdomains covers api.furlpay.com, api-staging.furlpay.com and
    // api-dev.furlpay.com from the single entry — the same reach the Android
    // config gets from includeSubdomains="true".
    ats.NSPinnedDomains = {
      ...(ats.NSPinnedDomains ?? {}),
      "furlpay.com": {
        NSIncludesSubdomains: true,
        NSPinnedCAIdentities: pins.map((hash) => ({ "SPKI-SHA256-BASE64": hash })),
      },
    };

    cfg.modResults.NSAppTransportSecurity = ats;
    return cfg;
  });
}

module.exports = withIosCertificatePinning;

// Named exports after the default assignment, which replaces module.exports
// wholesale — attaching them earlier would silently discard them. Exported so
// the invariants are testable without running a prebuild.
module.exports.ISRG_PINS = ISRG_PINS;
module.exports.AMAZON_PINS = AMAZON_PINS;
module.exports.PINS_VERIFIED_ON = PINS_VERIFIED_ON;
module.exports.assertBothHierarchiesPinned = assertBothHierarchiesPinned;
