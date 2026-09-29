//
//  StepUpDTOs.swift
//
//  Wire types for action-bound biometric step-up.
//
//  WHY THIS EXISTS
//
//  `BiometricGate` asks LocalAuthentication whether the person holding the phone
//  is the owner, and returns a Bool. That Bool never leaves the device. The
//  server therefore could not tell an approved request from an unapproved one,
//  and — measured across all seven endpoints Guardian can dispatch to — enforced
//  nothing: a bearer token alone placed a $25,000 order. The Face ID sheet in
//  `confirmAndDispatch` was decorative.
//
//  A local check cannot be fixed by being more careful about it. What crosses the
//  wire has to be evidence, so the gate for a money-moving action is a WebAuthn
//  assertion over a server-issued, transaction-bound challenge: the Secure
//  Enclave signs, the server verifies, and the proof it returns is single-use and
//  pinned to one exact request.
//
//  Server side: apps/web/src/lib/biometrics/actionProof.ts.
//
//  Plain Codable structs in Shared so both targets can see them. The ceremony
//  itself is iPhone-only and lives in Features/Security/ActionStepUpService.swift.
//

import Foundation

/// What the client declares it is about to send.
///
/// Declaring is NOT trusting: the server commits the digest to this, and the
/// executing route re-derives from the request it actually receives. Declaring
/// something harmless and sending something else produces a proof that fails to
/// validate. The declaration decides what the user is ASKED to approve.
public struct ActionStepUpIntent: Encodable, Sendable {
    public let endpoint: String
    public let method: String
    public let body: [String: JSONValue]

    public init(endpoint: String, method: String, body: [String: JSONValue]) {
        self.endpoint = endpoint
        self.method = method
        self.body = body
    }
}

/// Server response to the challenge request.
public struct ActionStepUpChallenge: Decodable, Sendable {
    public let challengeId: String
    public let options: Options

    /// The subset of the WebAuthn options this client needs.
    ///
    /// `allowCredentials`, `timeout` and `userVerification` are deliberately not
    /// decoded. `ASAuthorizationPlatformPublicKeyCredentialProvider` takes only
    /// the challenge and the relying party, and decoding fields that are then
    /// ignored invites someone to believe they are being honoured — in particular
    /// `userVerification: "required"`, which is enforced by the SERVER at
    /// verification time and cannot be enforced by asking the client nicely.
    public struct Options: Decodable, Sendable {
        public let challenge: String
        public let rpId: String?
    }
}

/// A completed assertion, in the shape the verify route's Zod schema expects.
public struct WebAuthnAssertionPayload: Encodable, Sendable {
    public let id: String
    public let rawId: String
    public let type: String
    public let response: Response

    public struct Response: Encodable, Sendable {
        public let clientDataJSON: String
        public let authenticatorData: String
        public let signature: String
        public let userHandle: String?
    }

    public init(
        credentialId: String,
        clientDataJSON: String,
        authenticatorData: String,
        signature: String,
        userHandle: String?
    ) {
        // `id` and `rawId` are the same value. WebAuthn's JSON serialisation
        // carries both — `rawId` is the ArrayBuffer and `id` its base64url form —
        // and @simplewebauthn reads `id`. Sending one and omitting the other fails
        // the server's schema rather than the signature check, which is a
        // confusing way to find out.
        self.id = credentialId
        self.rawId = credentialId
        self.type = "public-key"
        self.response = Response(
            clientDataJSON: clientDataJSON,
            authenticatorData: authenticatorData,
            signature: signature,
            userHandle: userHandle
        )
    }
}

public struct ActionStepUpVerifyRequest: Encodable, Sendable {
    public let challengeId: String
    public let assertion: WebAuthnAssertionPayload

    public init(challengeId: String, assertion: WebAuthnAssertionPayload) {
        self.challengeId = challengeId
        self.assertion = assertion
    }
}

public struct ActionStepUpProof: Decodable, Sendable {
    public let verified: Bool
    public let proofId: String
    public let expiresInSeconds: Int
}

/// The field a proof is attached to on the executing request.
///
/// Must match `STEP_UP_PROOF_FIELD` in
/// apps/web/src/lib/biometrics/enforceStepUp.ts. The server STRIPS this key
/// before re-deriving the digest, because the proof cannot exist at the moment
/// the digest is committed — the client has to declare the request to get a
/// challenge, and only then receives an id to attach. A mismatch here does not
/// fail loudly; it produces "this approval was for a different request" on every
/// call, which reads like a broken biometric flow rather than a typo.
public let kStepUpProofField = "stepUpProofId"
