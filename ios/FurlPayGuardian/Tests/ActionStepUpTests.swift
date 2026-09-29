//
//  ActionStepUpTests.swift
//
//  WHAT THESE PROTECT
//
//  The step-up flow spans two codebases that the compiler cannot reconcile: Swift
//  builds a JSON body, and a Zod schema in
//  apps/web/src/app/api/actions/step-up/verify/route.ts decides whether it is
//  acceptable. Nothing links them. A renamed key, a missing `rawId`, or standard
//  base64 where base64url was required all compile perfectly and fail at runtime
//  — and they fail as "verification failed", which reads like a rejected
//  fingerprint rather than a wire-format bug.
//
//  So the assertions below are deliberately about SHAPE and ENCODING rather than
//  about behaviour. The ceremony itself needs a Secure Enclave and a Face ID
//  prompt; it is verified on a device and listed as a manual check rather than
//  faked here.
//

import Testing
import Foundation
@testable import FurlPayGuardian

/// Re-encodes a value to the dictionary the server will actually parse.
private func encodedJSON(_ value: some Encodable) throws -> [String: Any] {
    let data = try JSONEncoder().encode(value)
    let object = try JSONSerialization.jsonObject(with: data)
    return object as? [String: Any] ?? [:]
}

@Suite("WebAuthn assertion wire format")
struct AssertionPayloadTests {

    private func sample() -> WebAuthnAssertionPayload {
        WebAuthnAssertionPayload(
            credentialId: "Y3JlZC1pZA",
            clientDataJSON: "Y2xpZW50LWRhdGE",
            authenticatorData: "YXV0aC1kYXRh",
            signature: "c2ln",
            userHandle: "dXNlcg"
        )
    }

    @Test("carries exactly the keys the verify schema requires")
    func topLevelKeys() throws {
        let json = try encodedJSON(sample())
        // VerifyAssertionSchema: id, rawId, response, type — all required.
        for key in ["id", "rawId", "response", "type"] {
            #expect(json[key] != nil, "missing required key \(key)")
        }
    }

    @Test("type is the literal the schema pins")
    func typeLiteral() throws {
        // `z.literal("public-key")`. Anything else is a 400 before the signature
        // is ever checked.
        let json = try encodedJSON(sample())
        #expect(json["type"] as? String == "public-key")
    }

    @Test("id and rawId are the same credential id")
    func idAndRawIdAgree() throws {
        // WebAuthn's JSON form carries both — `rawId` is the buffer, `id` its
        // base64url text — and @simplewebauthn matches the stored credential on
        // `id`. Sending one and omitting the other fails the SCHEMA rather than
        // the signature, which is a confusing way to discover the problem.
        let json = try encodedJSON(sample())
        #expect(json["id"] as? String == "Y3JlZC1pZA")
        #expect(json["rawId"] as? String == "Y3JlZC1pZA")
    }

    @Test("the response object carries the four signed fields")
    func responseKeys() throws {
        let json = try encodedJSON(sample())
        let response = json["response"] as? [String: Any]
        #expect(response != nil)
        #expect(response?["clientDataJSON"] as? String == "Y2xpZW50LWRhdGE")
        #expect(response?["authenticatorData"] as? String == "YXV0aC1kYXRh")
        #expect(response?["signature"] as? String == "c2ln")
        #expect(response?["userHandle"] as? String == "dXNlcg")
    }

    @Test("clientDataJSON and authenticatorData are not swapped")
    func fieldsNotTransposed() throws {
        // They are both opaque base64url blobs of similar shape, so a transposition
        // is invisible on inspection and produces only "verification failed".
        // Distinct sentinel values make the ordering assertable.
        let payload = WebAuthnAssertionPayload(
            credentialId: "id",
            clientDataJSON: "CLIENT",
            authenticatorData: "AUTH",
            signature: "SIG",
            userHandle: nil
        )
        let response = try encodedJSON(payload)["response"] as? [String: Any]
        #expect(response?["clientDataJSON"] as? String == "CLIENT")
        #expect(response?["authenticatorData"] as? String == "AUTH")
    }

    @Test("a nil userHandle is omitted rather than sent as null")
    func nilUserHandle() throws {
        // The schema has it `.optional()`, which accepts absent but NOT null.
        // Swift's default encoding of `String?` omits the key, and this pins that
        // — a future `encodeIfPresent` -> `encode` change would send null and be
        // rejected.
        let payload = WebAuthnAssertionPayload(
            credentialId: "id",
            clientDataJSON: "c",
            authenticatorData: "a",
            signature: "s",
            userHandle: nil
        )
        let response = try encodedJSON(payload)["response"] as? [String: Any]
        #expect(response?["userHandle"] == nil)
    }
}

@Suite("Step-up request bodies")
struct StepUpRequestTests {

    @Test("the intent names the endpoint, method and body")
    func intentShape() throws {
        let intent = ActionStepUpIntent(
            endpoint: "/investing/order",
            method: "POST",
            body: ["symbol": .string("AAPL"), "quantity": .number(1)]
        )
        let json = try encodedJSON(intent)
        #expect(json["endpoint"] as? String == "/investing/order")
        #expect(json["method"] as? String == "POST")
        let body = json["body"] as? [String: Any]
        #expect(body?["symbol"] as? String == "AAPL")
    }

    @Test("the verify request nests the assertion under `assertion`")
    func verifyShape() throws {
        let request = ActionStepUpVerifyRequest(
            challengeId: "act_chal_abc",
            assertion: WebAuthnAssertionPayload(
                credentialId: "id", clientDataJSON: "c",
                authenticatorData: "a", signature: "s", userHandle: nil
            )
        )
        let json = try encodedJSON(request)
        #expect(json["challengeId"] as? String == "act_chal_abc")
        #expect(json["assertion"] is [String: Any])
    }

    @Test("the proof field name matches the server constant")
    func proofFieldContract() {
        // Must equal STEP_UP_PROOF_FIELD in
        // apps/web/src/lib/biometrics/enforceStepUp.ts. The server STRIPS this key
        // before re-deriving the digest; if the names disagree it strips nothing,
        // hashes one extra field, and every high-value request fails with "this
        // approval was for a different request" — a total outage that looks like a
        // broken biometric flow rather than a typo.
        #expect(kStepUpProofField == "stepUpProofId")
    }
}

@Suite("base64url")
struct Base64URLTests {

    @Test("round-trips arbitrary bytes")
    func roundTrip() {
        // 0..255 covers every byte that can appear in a signature, including the
        // ones that produce `+` and `/` in standard base64 and must not survive.
        let original = Data((0...255).map { UInt8($0) })
        let encoded = original.base64URLEncodedString()
        #expect(Data(base64URLEncoded: encoded) == original)
    }

    @Test("uses the URL-safe alphabet and no padding")
    func alphabet() {
        // WebAuthn is base64url. Standard base64 fed to the server produces a
        // signature check that fails for no visible reason — the file's own
        // header says so, and nothing asserted it.
        let encoded = Data((0...255).map { UInt8($0) }).base64URLEncodedString()
        #expect(!encoded.contains("+"))
        #expect(!encoded.contains("/"))
        #expect(!encoded.contains("="))
        #expect(encoded.contains("-") || encoded.contains("_"), "no URL-safe characters appeared at all")
    }

    @Test("decodes input that is missing its padding")
    func decodesUnpadded() {
        // Every length class mod 4, since the decoder re-adds `=` itself and an
        // off-by-one there silently returns nil for one length in three.
        for length in 1...16 {
            let data = Data(repeating: 0xAB, count: length)
            let encoded = data.base64URLEncodedString()
            #expect(Data(base64URLEncoded: encoded) == data, "failed at length \(length)")
        }
    }

    @Test("decodes a padded, URL-safe string too")
    func decodesPadded() {
        // Servers are not obliged to strip padding, and a challenge that arrives
        // with `=` must still decode.
        let data = Data([0x01, 0x02, 0x03, 0x04, 0x05])
        var padded = data.base64URLEncodedString()
        while padded.count % 4 != 0 { padded += "=" }
        #expect(Data(base64URLEncoded: padded) == data)
    }

    @Test("rejects a string that is not base64 at all")
    func rejectsGarbage() {
        // Returns nil rather than empty Data. `assertion(challengeBase64URL:)`
        // turns that nil into a thrown error; decoding to empty would sign an
        // empty challenge and produce an assertion the server rejects for the
        // wrong reason.
        #expect(Data(base64URLEncoded: "!!!not base64!!!") == nil)
    }

    @Test("an empty string decodes to empty, not nil")
    func emptyString() {
        // Documents the boundary rather than asserting a preference: the guard in
        // `assertion(challengeBase64URL:)` is `Data(base64URLEncoded:)` returning
        // nil, so if empty decoded to nil an empty challenge would be caught
        // there, and if it decodes to empty it is caught by the server instead.
        #expect(Data(base64URLEncoded: "") == Data())
    }
}

// NOT TESTED HERE, deliberately.
//
// `ActionStepUpService.prove` distinguishes `.declined` (the user cancelled, or
// the server refused the signature) from `.unavailable` (no passkey), and the
// distinction is load-bearing: `confirmAndDispatch` rejects the action outright
// on the first and falls back to the local prompt on the second. Collapsing them
// would turn a cancelled Face ID sheet into a second chance via
// LocalAuthentication — an explicit "no" re-asked as a different question.
//
// Exercising that needs a live challenge endpoint and a Secure Enclave. It could
// be made testable by extracting the branch into a pure classifier, but the only
// caller would be the test: the two outcomes come from two DIFFERENT failure
// sources (the challenge request and the assertion), so a single function taking
// a boolean would be a fiction shaped by the desire to assert something.
//
// It is verified on a device instead, and listed as a manual check in the
// remediation report rather than covered by a test that proves nothing.
