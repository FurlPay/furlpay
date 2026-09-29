//
//  CertificatePinningTests.swift
//
//  WHY THIS FILE EXISTS
//
//  CertificatePinner.swift's own header claimed "the test suite asserts both
//  hierarchies are present". No test in this target referenced CertificatePinner,
//  spkiHash, pinsVerifiedOn or pinnedSPKIHashes — the claim was aspirational, and
//  it was covering a file that DID NOT COMPILE: `headerKey(for:)` wrote
//  `kSecAttrKeyTypeRSA as String` inside a case pattern, where `as` is a
//  type-casting pattern rather than a bridge, so all four cases were errors. No
//  iOS artifact had ever been produced.
//
//  A compile error is caught by any build. What a build does NOT catch is the
//  quieter half of this control: a pin transcribed one character wrong, an SPKI
//  header whose ASN.1 length is off by one, or a key type silently falling
//  through to nil. Each produces a pin mismatch indistinguishable from an attack,
//  on a binary already on the user's phone, with no remote fix.
//
//  SO THESE TESTS USE REAL CERTIFICATES.
//
//  Five roots are embedded as DER, downloaded from each CA's own publication
//  endpoint. Four are pinned anchors chosen to cover all four SPKI headers; the
//  fifth, DigiCert Global Root CA, is a genuinely valid and universally trusted
//  root that is deliberately NOT pinned — which is the actual threat model. An
//  MDM profile or user-installed root is not a malformed certificate, it is a
//  perfectly good one from the wrong CA, and a test that feeds random bytes to
//  the hasher never exercises that.
//
//  Each expected hash was computed from the embedded bytes with openssl, not
//  copied from the pin list it is checking. So these assertions can fail
//  independently of pinnedSPKIHashes being right, which is the only way the
//  comparison means anything.
//

import Testing
import Foundation
import Security
@testable import FurlPayGuardian

// MARK: - Fixtures

/// Real, published root certificates.
private enum Roots {

    /// ISRG Root X1 — RSA-4096. Pinned anchor, header `rsa-4096`.
    ///
    /// DER, base64, from https://letsencrypt.org/certs/isrgrootx1.pem
    static let isrgRootX1 = """
        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
        m+kXQ99b21/+jh5Xos1AnX5iItreGCc=
        """

    /// Ground-truth SPKI SHA-256 for ISRG Root X1, computed from the bytes above:
    ///   openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
    ///     | openssl dgst -sha256 -binary | openssl enc -base64
    static let isrgRootX1SPKI = "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M="

    /// ISRG Root X2 — EC P-384. Pinned anchor, header `ec-384`.
    ///
    /// DER, base64, from https://letsencrypt.org/certs/isrg-root-x2.pem
    static let isrgRootX2 = """
        MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQswCQYDVQQGEwJV
        UzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElT
        UkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVT
        MSkwJwYDVQQKEyBJbnRlcm5ldCBTZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNS
        RyBSb290IFgyMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0H
        ttwW+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9ItgKbppb
        d9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAdBgNV
        HQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZIzj0EAwMDaAAwZQIwe3lORlCEwkSHRhtF
        cP9Ymd70/aTSVaYgLXTWNLxBo1BfASdWtL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5
        U6VR5CmD1/iQMVtCnwr1/q4AaOeMSQ+2b1tbFfLn
        """

    /// Ground-truth SPKI SHA-256 for ISRG Root X2, computed from the bytes above:
    ///   openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
    ///     | openssl dgst -sha256 -binary | openssl enc -base64
    static let isrgRootX2SPKI = "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI="

    /// Amazon Root CA 1 — RSA-2048. Pinned anchor, header `rsa-2048`.
    ///
    /// DER, base64, from https://www.amazontrust.com/repository/AmazonRootCA1.pem
    static let amazonRootCA1 = """
        MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsFADA5MQswCQYD
        VQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6b24gUm9vdCBDQSAxMB4XDTE1
        MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTELMAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpv
        bjEZMBcGA1UEAxMQQW1hem9uIFJvb3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
        ggEBALJ4gHHKeNXjca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgH
        FzZM9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qwIFAGbHrQ
        gLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6VOujw5H5SNz/0egwLX0t
        dHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L93FcXmn/6pUCyziKrlA4b9v7LWIbxcce
        VOF34GfID5yHI9Y/QCB/IIDEgEw+OyQmjgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB
        /zAOBgNVHQ8BAf8EBAMCAYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3
        DQEBCwUAA4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDIU5PM
        CCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUsN+gDS63pYaACbvXy
        8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vvo/ufQJVtMVT8QtPHRh8jrdkPSHCa
        2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2
        xJNDd2ZhwLnoQdeXeGADbkpyrqXRfboQnoZsG4q5WTP468SQvvG5
        """

    /// Ground-truth SPKI SHA-256 for Amazon Root CA 1, computed from the bytes above:
    ///   openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
    ///     | openssl dgst -sha256 -binary | openssl enc -base64
    static let amazonRootCA1SPKI = "++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI="

    /// Amazon Root CA 3 — EC P-256. Pinned anchor, header `ec-256`.
    ///
    /// DER, base64, from https://www.amazontrust.com/repository/AmazonRootCA3.pem
    static let amazonRootCA3 = """
        MIIBtjCCAVugAwIBAgITBmyf1XSXNmY/Owua2eiedgPySjAKBggqhkjOPQQDAjA5MQswCQYDVQQG
        EwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6b24gUm9vdCBDQSAzMB4XDTE1MDUy
        NjAwMDAwMFoXDTQwMDUyNjAwMDAwMFowOTELMAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZ
        MBcGA1UEAxMQQW1hem9uIFJvb3QgQ0EgMzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABCmXp8ZB
        f8ANm+gBG1bG8lKlui2yEujSLtf6ycXYqm0fc4E7O5hrOXwzpcVOho6AF2hiRVd9RFgdszflZwjr
        Zt6jQjBAMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBSrttvXBp43
        rDCGB5Fwx5zEGbF4wDAKBggqhkjOPQQDAgNJADBGAiEA4IWSoxe3jfkrBqWTrBqYaGFy+uGh0Psc
        eGCmQ5nFuMQCIQCcAu/xlJyzlvnrxir4tiz+OpAUFteMYyRIHN8wfdVoOw==
        """

    /// Ground-truth SPKI SHA-256 for Amazon Root CA 3, computed from the bytes above:
    ///   openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
    ///     | openssl dgst -sha256 -binary | openssl enc -base64
    static let amazonRootCA3SPKI = "NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k="

    /// DigiCert Global Root CA — RSA-2048. NOT pinned, on purpose — the unapproved-CA control.
    ///
    /// DER, base64, from https://cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem
    static let digiCertGlobalRoot = """
        MIIDrzCCApegAwIBAgIQCDvgVpBCRrGhdWrJWZHHSjANBgkqhkiG9w0BAQUFADBhMQswCQYDVQQG
        EwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQuY29tMSAw
        HgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBDQTAeFw0wNjExMTAwMDAwMDBaFw0zMTExMTAw
        MDAwMDBaMGExCzAJBgNVBAYTAlVTMRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3
        dy5kaWdpY2VydC5jb20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IENBMIIBIjANBgkq
        hkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4jvhEXLeqKTTo1eqUKKPC3eQyaKl7hLOllsBCSDMAZOn
        TjC3U/dDxGkAV53ijSLdhwZAAIEJzs4bg7/fzTtxRuLWZscFs3YnFo97nh6Vfe63SKMI2tavegw5
        BmV/Sl0fvBf4q77uKNd0f3p4mVmFaG5cIzJLv07A6Fpt43C/dxC//AH2hdmoRBBYMql1GNXRor5H
        4idq9Joz+EkIYIvUX7Q6hL+hqkpMfT7PT19sdl6gSzeRntwi5m3OFBqOasv+zbMUZBfHWymeMr/y
        7vrTC0LUq7dBMtoM1O/4gdW7jVg/tRvoSSiicNoxBN33shbyTApOB6jtSj1etX+jkMOvJwIDAQAB
        o2MwYTAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUA95QNVbRTLtm
        8KPiGxvDl7I90VUwHwYDVR0jBBgwFoAUA95QNVbRTLtm8KPiGxvDl7I90VUwDQYJKoZIhvcNAQEF
        BQADggEBAMucN6pIExIK+t1EnE9SsPTfrgT1eXkIoyQY/EsrhMAtudXH/vTBH1jLuG2cenTnmCmr
        EbXjcKChzUyImZOMkXDiqw8cvpOp/2PV5Adg06O/nVsJ8dWO41P0jmP6P6fbtGbfYmbW0W5BjfIt
        tep3Sp+dWOIrWcBAI+0tKIJFPnlUkiaY4IBIqDfv8NZ5YBberOgOzW6sRBc4L0na4UU+Krk2U886
        UAb3LujEV0lsYSEY1QSteDwsOoBrp+uvFRTp2InBuThs4pFsiv9kuXclVzDAGySj4dzp30d8tbQk
        CAUw7C29C79Fv1C5qfPrmAESrciIxpg0X40KPMbp1ZWVbd4=
        """

    /// Ground-truth SPKI SHA-256 for DigiCert Global Root CA, computed from the bytes above:
    ///   openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
    ///     | openssl dgst -sha256 -binary | openssl enc -base64
    static let digiCertGlobalRootSPKI = "r/mIkG3eEpVdm+u/ko/cwxzOMo1bk4TyHIlByibiA5E="

    /// Decodes one of the constants above into a `SecCertificate`.
    ///
    /// Force-unwrapped on purpose: these are compile-time constants, so a failure
    /// here is a corrupted fixture, not a runtime condition worth modelling. A
    /// test that silently skipped a mangled certificate would report success
    /// while checking nothing.
    static func certificate(_ base64: String) -> SecCertificate {
        let der = Data(base64Encoded: base64.filter { !$0.isWhitespace })!
        return SecCertificateCreateWithData(nil, der as CFData)!
    }
}

// Bridged to `String` at file scope rather than held as `CFString`. Two reasons:
// `SecKeyCopyAttributes` hands the value back already bridged, so this matches
// what the function really sees; and a global `let` of a non-Sendable imported
// class type like `CFString` is an error under Swift 6 strict concurrency, while
// `String` is Sendable.
private let rsaType = kSecAttrKeyTypeRSA as String
private let ecType = kSecAttrKeyTypeECSECPrimeRandom as String

/// Builds the attribute dictionary `headerKey(for:)` reads, without needing a key.
///
/// `SecKeyCopyAttributes` returns exactly these two entries among others, so
/// constructing them directly tests the decision rather than the Security
/// framework — and lets key types and sizes be tested that no CA we pin uses.
private func attributes(type: String?, bits: Int?) -> [CFString: Any] {
    var attrs: [CFString: Any] = [:]
    if let type { attrs[kSecAttrKeyType] = type }
    if let bits { attrs[kSecAttrKeySizeInBits] = bits }
    return attrs
}

// MARK: - The function that failed to build

@Suite("SPKI header selection")
struct HeaderKeyTests {

    // Each of these was a compile error before the fix. Asserting the MAPPING —
    // rather than merely that the file builds — also catches the subtler
    // regression where a case compiles but compares against the wrong constant
    // and silently returns nil, which fails the pin closed and looks like an
    // outage rather than a bug.
    @Test("RSA-2048 selects the rsa-2048 header")
    func rsa2048() {
        #expect(CertificatePinner.headerKey(for: attributes(type: rsaType, bits: 2048)) == "rsa-2048")
    }

    @Test("RSA-4096 selects the rsa-4096 header")
    func rsa4096() {
        #expect(CertificatePinner.headerKey(for: attributes(type: rsaType, bits: 4096)) == "rsa-4096")
    }

    @Test("EC P-256 selects the ec-256 header")
    func ec256() {
        #expect(CertificatePinner.headerKey(for: attributes(type: ecType, bits: 256)) == "ec-256")
    }

    @Test("EC P-384 selects the ec-384 header")
    func ec384() {
        #expect(CertificatePinner.headerKey(for: attributes(type: ecType, bits: 384)) == "ec-384")
    }

    @Test("every supported combination resolves, none fall through")
    func allFourResolve() {
        // Guards against a PARTIAL regression: if the bridge broke for one
        // constant only, three cases would still pass and the fourth would return
        // nil — an outage for exactly the CAs using that key type.
        let supported = [
            (rsaType, 2048, "rsa-2048"),
            (rsaType, 4096, "rsa-4096"),
            (ecType, 256, "ec-256"),
            (ecType, 384, "ec-384"),
        ]
        for (type, bits, expected) in supported {
            #expect(CertificatePinner.headerKey(for: attributes(type: type, bits: bits)) == expected)
        }
    }

    @Test("an unsupported key SIZE is refused")
    func unsupportedSize() {
        // nil is a REFUSAL, not a pass. spkiHash propagates it and isTrusted
        // treats a missing hash as no match, so an unrecognised key can never
        // satisfy the pin by being unhashable.
        let unsupported = [
            (rsaType, 1024),  // too weak, and once common
            (rsaType, 3072),  // plausible, simply not a size we pin
            (rsaType, 8192),
            (rsaType, 0),
            (ecType, 224),
            (ecType, 521),    // P-521 is real; we pin no P-521 root
            (ecType, 2048),   // right number, wrong algorithm for it
        ]
        for (type, bits) in unsupported {
            #expect(
                CertificatePinner.headerKey(for: attributes(type: type, bits: bits)) == nil,
                "\(type)/\(bits) must not resolve to a header"
            )
        }
    }

    @Test("an unsupported key TYPE is refused")
    func unsupportedType() {
        // A correct SIZE with the wrong algorithm must not borrow that size's
        // header: the header encodes the AlgorithmIdentifier, so pairing an EC key
        // with an RSA header hashes to a value matching nothing.
        //
        // iOS's Security framework exposes no DSA constant (kSecAttrKeyTypeDSA is
        // macOS-only), so "a type we do not handle" has to be spelled as a raw
        // value outside the two we do.
        //
        // AND THE RAW VALUES ARE NOT DESCRIPTIVE NAMES. These constants carry CSSM
        // algorithm ids as strings:
        //
        //     kSecAttrKeyTypeRSA              == "42"
        //     kSecAttrKeyTypeDSA              == "43"   (macOS only)
        //     kSecAttrKeyTypeEC               == "73"
        //     kSecAttrKeyTypeECSECPrimeRandom == "73"   (same value as above)
        //
        // So "42" and "73" must NEVER appear in this list — they are the SUPPORTED
        // types, and asserting they resolve to nil asserts the opposite of the
        // behaviour this file exists to protect. "43" is the honest DSA case: a
        // real algorithm id this app deliberately does not pin.
        //
        // Rather than trust the comment, the list is FILTERED against the bridged
        // constants. A supported value added here by mistake is dropped instead of
        // being asserted about, so the trap cannot be reintroduced — and it keeps
        // holding if Apple ever renumbers these.
        let candidates = ["43", "0", "", "4", "420", "rsa-2048", "RSA", "ec", "dsa"]
        let unknownTypes = candidates.filter { $0 != rsaType && $0 != ecType }
        #expect(unknownTypes.count == candidates.count,
                "a candidate collided with a supported key type and was skipped")

        for unknown in unknownTypes {
            // Both a supported and an unsupported size, so the refusal comes from
            // the TYPE rather than from the size happening not to match.
            #expect(
                CertificatePinner.headerKey(for: attributes(type: unknown, bits: 2048)) == nil,
                "key type \(unknown) must not resolve to a header"
            )
            #expect(CertificatePinner.headerKey(for: attributes(type: unknown, bits: 256)) == nil)
            #expect(CertificatePinner.headerKey(for: attributes(type: unknown, bits: 1024)) == nil)
        }
    }

    @Test("missing attributes are refused")
    func malformedAttributes() {
        #expect(CertificatePinner.headerKey(for: [:]) == nil)
        #expect(CertificatePinner.headerKey(for: attributes(type: rsaType, bits: nil)) == nil)
        #expect(CertificatePinner.headerKey(for: attributes(type: nil, bits: 2048)) == nil)
        #expect(CertificatePinner.headerKey(for: attributes(type: nil, bits: nil)) == nil)
    }

    @Test("a key size that is not an Int is refused, not coerced")
    func sizeTypeConfusion() {
        // SecKeyCopyAttributes documents CFNumber, and `as? Int` is what reads it.
        // A String "2048" must fail the guard rather than being parsed — accepting
        // it would mean trusting an attribute shape the framework never promised.
        let attrs: [CFString: Any] = [
            kSecAttrKeyType: rsaType,
            kSecAttrKeySizeInBits: "2048",
        ]
        #expect(CertificatePinner.headerKey(for: attrs) == nil)
    }

    @Test("a CFString key type that was never bridged is refused")
    func unbridgedTypeIsRefused() {
        // Documents what the ORIGINAL bug would have done had it compiled:
        // `attributes[kSecAttrKeyType] as? String` yields nil for an unbridged
        // CFString, so the guard refuses rather than mis-selecting a header. This
        // is a local dictionary, so holding a CFString here is fine — the Swift 6
        // restriction applies to globals.
        let attrs: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeRSA,  // CFString, deliberately NOT bridged
            kSecAttrKeySizeInBits: 2048,
        ]
        #expect(CertificatePinner.headerKey(for: attrs) == nil)
    }
}

// MARK: - Which hosts pinning applies to

@Suite("Pinned host scope")
struct PinnedHostTests {

    @Test("our own hosts are pinned", arguments: [
        "furlpay.com",
        "api.furlpay.com",
        "www.furlpay.com",
        "staging.api.furlpay.com",
        "FURLPAY.COM",            // DNS names are case-insensitive
        "Api.FurlPay.Com",
        "furlpay.com.",           // fully-qualified form of the same name
        "API.FURLPAY.COM.",
    ])
    func pinned(host: String) {
        // Every miss here fails OPEN: isTrusted short-circuits to `true` for a
        // host it does not recognise, so a spelling this function rejects loses
        // pinning silently rather than loudly.
        #expect(CertificatePinner.isPinned(host: host))
    }

    @Test("everything else is not", arguments: [
        "evilfurlpay.com",        // ends with furlpay.com but is not a subdomain
        "notfurlpay.com",
        "furlpay.com.evil.com",   // suffix confusion: our name as a LABEL, not the tail
        "xfurlpay.com",
        "furlpay.co",
        "furlpay.com.br",
        "example.com",
        "localhost",
        "",
    ])
    func notPinned(host: String) {
        #expect(!CertificatePinner.isPinned(host: host))
    }

    @Test("a third-party host is not pinned")
    func thirdPartyHostsPassThrough() {
        // Pinning a host whose certificate we do not control would break it on
        // that CA's rotation schedule rather than ours.
        #expect(!CertificatePinner.isPinned(host: "tile.openstreetmap.org"))
        #expect(!CertificatePinner.isPinned(host: "images.unsplash.com"))
    }
}

// MARK: - The pin set itself

@Suite("Pin set integrity")
struct PinSetTests {

    /// Every value here was verified against the CA's published root with openssl
    /// before being written down, so this list is an independent transcription of
    /// the same facts rather than a copy of the array it checks.
    static let letsEncrypt = [
        "fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88=",  // ISRG Root YR, RSA-4096
        "sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=",  // ISRG Root YE, EC P-384
        "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=",  // ISRG Root X1, RSA-4096
        "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=",  // ISRG Root X2, EC P-384
    ]

    static let amazonTrust = [
        "++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=",  // Amazon Root CA 1, RSA-2048
        "f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=",  // Amazon Root CA 2, RSA-4096
        "NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=",  // Amazon Root CA 3, EC P-256
        "9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=",  // Amazon Root CA 4, EC P-384
        "KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=",  // Starfield Services G2, RSA-2048
    ]

    @Test("both CA hierarchies are present")
    func bothHierarchies() {
        // The claim CertificatePinner.swift's header already made, now actually
        // asserted. Both are load-bearing during the AWS migration: Vercel serves
        // *.furlpay.com from Let's Encrypt today, CloudFront + ACM from Amazon
        // Trust Services in the new environments. Dropping either turns the
        // cutover into a total outage for one set of hosts, on a shipped binary.
        for pin in Self.letsEncrypt {
            #expect(CertificatePinner.pinnedSPKIHashes.contains(pin), "missing Let's Encrypt anchor")
        }
        for pin in Self.amazonTrust {
            #expect(CertificatePinner.pinnedSPKIHashes.contains(pin), "missing Amazon Trust anchor")
        }
    }

    @Test("the gen-Y Let's Encrypt roots are pinned")
    func genYRootsPresent() {
        // YR and YE are what new chains use as X1 and X2 age out. Pinning only the
        // X generation would expire this build on the CA's schedule, and the
        // symptom would be a total API outage with no remote fix.
        #expect(CertificatePinner.pinnedSPKIHashes.contains("fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88="))
        #expect(CertificatePinner.pinnedSPKIHashes.contains("sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w="))
    }

    @Test("both key families are covered in each hierarchy")
    func keyFamilyCoverage() {
        // An RSA-only pin set breaks the moment a host is served from an EC chain,
        // and vice versa. Each hierarchy needs at least one of each, which is why
        // all four SPKI headers exist.
        #expect(CertificatePinner.pinnedSPKIHashes.contains("C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M="))  // LE RSA
        #expect(CertificatePinner.pinnedSPKIHashes.contains("diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI="))  // LE EC
        #expect(CertificatePinner.pinnedSPKIHashes.contains("++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI="))  // AWS RSA
        #expect(CertificatePinner.pinnedSPKIHashes.contains("NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k="))  // AWS EC
    }

    @Test("every pin is a base64 SHA-256 digest")
    func pinsAreWellFormed() {
        for pin in CertificatePinner.pinnedSPKIHashes {
            let decoded = Data(base64Encoded: pin)
            #expect(decoded != nil, "pin is not valid base64: \(pin)")
            // 32 bytes. A truncated or padded pin is still valid base64 and would
            // simply never match — a silent total outage rather than a loud error.
            #expect(decoded?.count == 32, "pin is not a 32-byte digest: \(pin)")
        }
    }

    @Test("no pin was lost to a duplicate")
    func pinCount() {
        // A Set silently absorbs a copy-paste duplicate, so the literal could list
        // nine entries and store eight. This asserts the STORED count, and the
        // union below asserts the two hierarchies account for all of it — together
        // they catch both a dropped pin and an unexplained extra one.
        #expect(CertificatePinner.pinnedSPKIHashes.count == 9)
        #expect(CertificatePinner.pinnedSPKIHashes == Set(Self.letsEncrypt).union(Self.amazonTrust))
    }

    @Test("the pin set is not empty")
    func notEmpty() {
        // The catastrophic edit: an empty set makes isTrusted return false for
        // every pinned host, bricking the app's own API entirely.
        #expect(!CertificatePinner.pinnedSPKIHashes.isEmpty)
    }

    @Test("pinsVerifiedOn is a real, non-future date")
    func verifiedDateParses() {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        let parsed = formatter.date(from: CertificatePinner.pinsVerifiedOn)
        #expect(parsed != nil, "pinsVerifiedOn must be yyyy-MM-dd")
        // A future date would mean the marker was bumped without anyone actually
        // re-checking the pins, which is the one thing it exists to record. One
        // day of slack for timezones.
        if let parsed {
            #expect(parsed <= Date().addingTimeInterval(86_400), "pinsVerifiedOn is in the future")
        }
    }
}

// MARK: - End to end, against real certificates

@Suite("SPKI hashing of published roots")
struct RealCertificateTests {

    /// Each pinned root must hash to its openssl-computed value AND be in the pin
    /// set. Two independent assertions: the first proves the SPKI header
    /// reconstruction is byte-correct, the second proves the pin was transcribed
    /// correctly. Collapsing them into one comparison would let two matching
    /// mistakes cancel out and report success.
    @Test("pinned roots hash to their published SPKI digest")
    func pinnedRootHashes() {
        let roots = [
            (Roots.isrgRootX1, Roots.isrgRootX1SPKI, "ISRG Root X1"),
            (Roots.isrgRootX2, Roots.isrgRootX2SPKI, "ISRG Root X2"),
            (Roots.amazonRootCA1, Roots.amazonRootCA1SPKI, "Amazon Root CA 1"),
            (Roots.amazonRootCA3, Roots.amazonRootCA3SPKI, "Amazon Root CA 3"),
        ]
        for (der, expected, name) in roots {
            let hash = CertificatePinner.spkiHash(of: Roots.certificate(der))
            #expect(hash == expected, "\(name): SPKI reconstruction is wrong")
            #expect(CertificatePinner.pinnedSPKIHashes.contains(expected), "\(name): not in the pin set")
        }
    }

    @Test("all four SPKI headers are exercised by a real certificate")
    func allHeadersCovered() {
        // Every header in spkiHeaders is reachable AND correct. An unreachable
        // header is dead code; a wrong one is an outage for the CAs using that key
        // type, and only a real certificate tells those two apart.
        let byHeader = [
            ("rsa-4096", Roots.isrgRootX1),
            ("ec-384", Roots.isrgRootX2),
            ("rsa-2048", Roots.amazonRootCA1),
            ("ec-256", Roots.amazonRootCA3),
        ]
        for (header, der) in byHeader {
            let certificate = Roots.certificate(der)
            guard let key = SecCertificateCopyKey(certificate),
                  let attrs = SecKeyCopyAttributes(key) as? [CFString: Any] else {
                Issue.record("could not read the public key for \(header)")
                continue
            }
            #expect(CertificatePinner.headerKey(for: attrs) == header)
            // And the hash actually computes — proving spkiHeaders has an entry
            // for the name headerKey returned. A header name with no table entry
            // makes spkiHash return nil and fails the pin closed.
            #expect(CertificatePinner.spkiHash(of: certificate) != nil, "no header table entry for \(header)")
        }
    }

    @Test("a valid but UNPINNED root fails the pin")
    func unpinnedRootIsRejected() {
        // The real threat model: an MDM profile or user-installed root is not a
        // malformed certificate, it is a perfectly valid one from a CA we never
        // approved. App Transport Security accepts it; the pin must not.
        //
        // DigiCert Global Root CA is RSA-2048 — the same key type as a pinned
        // Amazon root — so hashing SUCCEEDS here. The rejection therefore comes
        // from the pin set rather than from spkiHash bailing out, which is the
        // only version of this test that proves anything.
        let certificate = Roots.certificate(Roots.digiCertGlobalRoot)
        let hash = CertificatePinner.spkiHash(of: certificate)
        #expect(hash == Roots.digiCertGlobalRootSPKI, "hashing must succeed for the rejection to mean anything")
        if let hash {
            #expect(!CertificatePinner.pinnedSPKIHashes.contains(hash), "an unapproved CA is in the pin set")
        }
    }

    @Test("hashing is deterministic")
    func stableAcrossCalls() {
        // SHA-256 over a reconstructed buffer. If the header were ever appended in
        // place rather than copied into a fresh Data, the second call would differ.
        let first = CertificatePinner.spkiHash(of: Roots.certificate(Roots.isrgRootX1))
        let second = CertificatePinner.spkiHash(of: Roots.certificate(Roots.isrgRootX1))
        #expect(first == second)
        #expect(first != nil)
    }

    @Test("two different roots do not hash alike")
    func distinctRootsDistinctHashes() {
        // Catches a hasher that ignores its input — for example a header appended
        // to an empty buffer, which would make every certificate of one key type
        // produce the same digest.
        let a = CertificatePinner.spkiHash(of: Roots.certificate(Roots.amazonRootCA1))
        let b = CertificatePinner.spkiHash(of: Roots.certificate(Roots.digiCertGlobalRoot))
        #expect(a != b, "two RSA-2048 roots hashed to the same value")
    }
}
