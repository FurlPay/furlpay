//
//  CertificatePinner.swift
//
//  SPKI pinning for furlpay.com on iOS and watchOS.
//
//  WHY THIS EXISTS
//
//  Pinning was implemented once, well, for the React Native Android app and
//  nowhere else. This app holds the same session token, and its watch target
//  calls the API on its own when the phone is unreachable, with no pinning at
//  all. App Transport Security enforces TLS but not WHICH certificate authority
//  signed it — any CA in the system trust store is accepted, which is precisely
//  what an enterprise MDM profile or a user-installed root defeats.
//
//  WHAT IS PINNED
//
//  The SubjectPublicKeyInfo of the trust ANCHOR, not a leaf and not an
//  intermediate. Leaves rotate every ~90 days; intermediates rotate on the CA's
//  own schedule. Pinning either turns a routine rotation into a total outage
//  with no remote fix — the app is already on the user's phone.
//
//  Both CA hierarchies are pinned, and both are load-bearing during the AWS
//  migration: *.furlpay.com is served by Vercel (Let's Encrypt) today and by
//  CloudFront + ACM (Amazon Trust Services) in the new environments. The values
//  are identical to guardian/core/network/FurlPayPinning.kt and to
//  native-app/plugins/withNetworkSecurityConfig.js — three implementations, one
//  set of anchors, because a hostname pinned differently per platform is a
//  cutover that half-breaks.
//
//  THE FAILURE MODE IS DELIBERATE AND TOTAL
//
//  A handshake that does not match fails. There is no "warn and continue": a
//  pinning check that can be talked out of its verdict is not a control. The
//  cost is that a mis-pinned build cannot reach the backend at all, which is
//  why `pinsVerifiedOn` exists and why Tests/CertificatePinningTests.swift
//  asserts both hierarchies are present.
//
//  That claim used to be aspirational — no test in this project referenced this
//  type at all, and the file itself did not compile (see `headerKey(for:)`). The
//  tests now hash four of the pinned roots from embedded DER and compare against
//  digests computed independently with openssl, so a mis-transcribed pin or an
//  off-by-one ASN.1 header fails the suite rather than the handshake. All nine
//  pins were re-verified against the CAs' published roots on 2026-09-26.
//

import Foundation
import CryptoKit

public enum CertificatePinner {

    /// Bump when any pin is added, removed, or re-verified against the source.
    public static let pinsVerifiedOn = "2026-09-25"

    /// Base64 SHA-256 of each anchor's SubjectPublicKeyInfo.
    ///
    /// Recomputed from the published root certificates rather than transcribed:
    ///   openssl x509 -in <root>.pem -pubkey -noout \
    ///     | openssl pkey -pubin -outform der \
    ///     | openssl dgst -sha256 -binary | openssl enc -base64
    static let pinnedSPKIHashes: Set<String> = [
        // --- Let's Encrypt (Vercel-served hosts) ---------------------------
        "fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88=", // ISRG Root YR (RSA, gen-Y)
        "sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=", // ISRG Root YE (EC, gen-Y)
        "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=", // ISRG Root X1 (RSA)
        "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=", // ISRG Root X2 (EC)

        // --- Amazon Trust Services (ACM / CloudFront) ----------------------
        "++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=", // Amazon Root CA 1
        "f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=", // Amazon Root CA 2
        "NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=", // Amazon Root CA 3
        "9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=", // Amazon Root CA 4
        "KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=", // Starfield Services Root CA G2
    ]

    /// Hosts pinning applies to.
    ///
    /// Anything else — a hotel photo CDN, a map tile server — goes through
    /// ordinary system validation. Pinning a host whose certificate we do not
    /// control would break it on the CA's schedule rather than ours.
    static func isPinned(host: String) -> Bool {
        // Lowercased first. DNS hostnames are case-insensitive, so `FurlPay.com`
        // and `furlpay.com` are the same host — but the raw comparison treated
        // the first as a third-party domain and SKIPPED PINNING for it. The app
        // builds its own URLs from a lowercase constant so this was not reachable
        // today, and it is one character to make it unreachable by construction
        // rather than by the caller's habits.
        //
        // The suffix form keeps the leading dot deliberately: `.furlpay.com`
        // matches `api.furlpay.com` but not `evilfurlpay.com`, which a bare
        // `hasSuffix("furlpay.com")` would happily pin — and, worse, would let an
        // attacker-controlled host inherit our pin set and fail closed in a way
        // that looks like our outage.
        // The trailing dot goes too. `furlpay.com.` is the fully-qualified form of
        // the same name and resolves identically, but it matched neither branch,
        // so pinning was SKIPPED for it. Note the direction of that failure: an
        // unrecognised host is not rejected here, it is handed to ordinary system
        // validation — so every gap in this function fails OPEN. That is the right
        // default for a photo CDN and the wrong one for our own API, which is why
        // the matching is deliberately generous about spelling and strict about
        // which name it is.
        var normalized = host.lowercased()
        if normalized.hasSuffix(".") { normalized.removeLast() }

        return normalized == "furlpay.com" || normalized.hasSuffix(".furlpay.com")
    }

    /// ASN.1 DER headers prepended to a raw public key before hashing.
    ///
    /// `SecKeyCopyExternalRepresentation` returns the BARE key, while a
    /// SubjectPublicKeyInfo is that key wrapped in an AlgorithmIdentifier. The
    /// published pin values are over the SPKI, so hashing the bare key produces
    /// a digest that matches nothing — and the resulting "pin mismatch" looks
    /// like an attack rather than a units error. These constants reconstruct
    /// the wrapper for the key types the pinned CAs actually use.
    private static let spkiHeaders: [String: [UInt8]] = [
        "rsa-2048": [
            0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
            0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00,
        ],
        "rsa-4096": [
            0x30, 0x82, 0x02, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
            0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x02, 0x0f, 0x00,
        ],
        "ec-256": [
            0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
            0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
            0x42, 0x00,
        ],
        "ec-384": [
            0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
            0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x62, 0x00,
        ],
    ]

    // `kSecAttrKeyType*` are `CFString`, and `SecKeyCopyAttributes` hands them
    // back bridged to `String`. Writing the bridge INSIDE a case pattern does not
    // work:
    //
    //     case (kSecAttrKeyTypeRSA as String, 2048):
    //
    // There, `as` is parsed as a TYPE-CASTING PATTERN, not as an expression, so
    // the constant is never bridged and the compiler reports "expression pattern
    // of type 'CFString' cannot match values of type 'String'". That is exactly
    // what failed the build — four errors, one per case, and no iOS artifact has
    // ever been produced as a result.
    //
    // Hoisting the bridge into a stored constant makes each case an ordinary
    // expression pattern, matched with `==`. Same values, same semantics, and the
    // bridge now happens where `as` means what it looks like it means.
    private static let rsaKeyType = kSecAttrKeyTypeRSA as String
    private static let ecKeyType = kSecAttrKeyTypeECSECPrimeRandom as String

    /// Which SPKI header prefix a key needs, or nil for a key type we do not pin.
    ///
    /// Returning nil is a REFUSAL, not a pass: `spkiHash(of:)` propagates it and
    /// `validate` treats a missing hash as a failed pin. An unknown key type must
    /// never be waved through simply because we could not compute its hash.
    static func headerKey(for attributes: [CFString: Any]) -> String? {
        guard let type = attributes[kSecAttrKeyType] as? String,
              let bits = attributes[kSecAttrKeySizeInBits] as? Int else { return nil }
        switch (type, bits) {
        case (Self.rsaKeyType, 2048): return "rsa-2048"
        case (Self.rsaKeyType, 4096): return "rsa-4096"
        case (Self.ecKeyType, 256): return "ec-256"
        case (Self.ecKeyType, 384): return "ec-384"
        default: return nil
        }
    }

    /// Base64 SHA-256 over the SPKI of `certificate`'s public key, or nil when
    /// the key is of a type we have no header for.
    static func spkiHash(of certificate: SecCertificate) -> String? {
        guard let key = SecCertificateCopyKey(certificate),
              let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
              let headerKey = headerKey(for: attributes),
              let header = spkiHeaders[headerKey],
              let raw = SecKeyCopyExternalRepresentation(key, nil) as Data? else {
            return nil
        }
        var spki = Data(header)
        spki.append(raw)
        return Data(SHA256.hash(data: spki)).base64EncodedString()
    }

    /// Does `trust` chain through one of the pinned anchors?
    ///
    /// EVERY certificate in the chain is checked, not just the root. Apple does
    /// not guarantee the anchor is included in the evaluated chain when it comes
    /// from the system trust store, so requiring it at a fixed index would fail
    /// intermittently in a way that looks like a network problem.
    ///
    /// System validation runs FIRST. Pinning is an additional constraint on top
    /// of expiry, hostname and revocation checks — never a replacement for them.
    static func isTrusted(_ trust: SecTrust, host: String) -> Bool {
        var error: CFError?
        guard SecTrustEvaluateWithError(trust, &error) else { return false }
        guard isPinned(host: host) else { return true }

        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate] else {
            return false
        }
        for certificate in chain {
            if let hash = spkiHash(of: certificate), pinnedSPKIHashes.contains(hash) {
                return true
            }
        }
        return false
    }
}

/// `URLSessionDelegate` that applies ``CertificatePinner``.
///
/// A final class rather than an extension on the API client: `URLSession`
/// retains its delegate for the session's lifetime, so putting this on the
/// client would create a retain cycle with an actor that is otherwise a
/// singleton.
public final class PinnedSessionDelegate: NSObject, URLSessionDelegate, Sendable {

    public func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            // Not a server-trust challenge (proxy auth, client certs) — let the
            // system handle it rather than cancelling something unrelated.
            completionHandler(.performDefaultHandling, nil)
            return
        }

        // Unpinned hosts still require ordinary system certificate validation.
        // Never supply a trust credential merely because a host is not ours.
        guard CertificatePinner.isPinned(host: challenge.protectionSpace.host) else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        if CertificatePinner.isTrusted(trust, host: challenge.protectionSpace.host) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            // Cancel, never `.performDefaultHandling`. Falling back to default
            // handling on a pin mismatch would accept exactly the certificate
            // the pin was there to reject.
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

public extension URLSession {
    /// The session every FurlPay API call goes through.
    ///
    /// `URLSession.shared` is deliberately not used and cannot be: it accepts no
    /// delegate, so there is no seam to apply pinning through. This is created
    /// once — a URLSession per request leaks connections and defeats HTTP/2
    /// multiplexing — and holds its delegate for its lifetime, which is why
    /// `PinnedSessionDelegate` is a standalone object rather than the client.
    static let pinned: URLSession = {
        let configuration = URLSessionConfiguration.default
        // Matches the React Native client's DEFAULT_TIMEOUT_MS. A payment
        // request that hangs forever is worse than one that fails: nothing
        // retries and nothing queues.
        configuration.timeoutIntervalForRequest = 20
        configuration.waitsForConnectivity = false
        return URLSession(
            configuration: configuration,
            delegate: PinnedSessionDelegate(),
            delegateQueue: nil
        )
    }()
}
