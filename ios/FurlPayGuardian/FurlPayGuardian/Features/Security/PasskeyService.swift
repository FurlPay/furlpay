//
//  PasskeyService.swift
//
//  Port of native-app/lib/passkey.ts onto AuthenticationServices.
//
//  Passkeys are the one place where the iOS implementation is genuinely
//  stronger than the RN one rather than merely equivalent: the private key is
//  generated in the Secure Enclave and synced through iCloud Keychain, and the
//  app never sees it. There is no secret here to leak.
//
//  The relying-party identifier MUST match a domain serving
//  /.well-known/apple-app-site-association with a `webcredentials` entry for
//  this bundle id. Without it registration fails with a generic error that
//  looks like a code bug and is not one.
//

import Foundation
import AuthenticationServices

// PasskeyCredential now lives in Shared/Network/DTOs.swift, beside the
// PasskeysResponse and PasskeyCredentialResponse that decode it. It was
// declared here, in a file that only belongs to the iPhone target, while
// DTOs.swift compiles into the watch target too — so the watch build failed
// with "cannot find type 'PasskeyCredential' in scope". It is a plain data
// type with no AuthenticationServices dependency; only the service below
// needs that framework, and only the phone runs the service.

public enum PasskeyError: Error, LocalizedError {
    case cancelled
    case notSupported
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .cancelled:      "Cancelled."
        case .notSupported:   "Passkeys need iOS 16 or later."
        case .failed(let m):  m
        }
    }
}

@MainActor
public final class PasskeyService: NSObject {

    /// Must match the `webcredentials:` domain in the app's associated-domains
    /// entitlement.
    /// Re-exported from PasskeyConfig (Shared), which is the single source of
    /// truth so the watch target can see it too.
    public static let relyingParty = PasskeyConfig.relyingParty

    private let api: FurlPayAPIClient
    private var continuation: CheckedContinuation<ASAuthorization, Error>?

    public init(api: FurlPayAPIClient) {
        self.api = api
    }

    public func credentials() async throws -> [PasskeyCredential] {
        try await api.fetchPasskeys()
    }

    /// Registers a new passkey.
    ///
    /// The challenge comes from the SERVER and is single-use. A client-chosen
    /// challenge would make the resulting attestation replayable, which defeats
    /// the point of the ceremony.
    public func register(displayName: String) async throws -> PasskeyCredential {
        let options = try await api.beginPasskeyRegistration()
        guard let challenge = Data(base64URLEncoded: options.challenge),
              let userId = Data(base64URLEncoded: options.userId)
        else {
            throw PasskeyError.failed("The server sent an invalid challenge.")
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: options.relyingPartyId
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge, name: displayName, userID: userId
        )

        let authorization = try await perform([request])
        guard let credential = authorization.credential
            as? ASAuthorizationPlatformPublicKeyCredentialRegistration
        else {
            throw PasskeyError.failed("Unexpected credential type.")
        }

        return try await api.completePasskeyRegistration(
            credentialId: credential.credentialID.base64URLEncodedString(),
            attestationObject: credential.rawAttestationObject?.base64URLEncodedString() ?? "",
            clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString(),
            label: displayName
        )
    }

    /// Authenticates with an existing passkey.
    public func authenticate() async throws -> String {
        let options = try await api.beginPasskeyAuthentication()
        guard let challenge = Data(base64URLEncoded: options.challenge) else {
            throw PasskeyError.failed("The server sent an invalid challenge.")
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: options.relyingPartyId
        )
        let request = provider.createCredentialAssertionRequest(challenge: challenge)

        let authorization = try await perform([request])
        guard let credential = authorization.credential
            as? ASAuthorizationPlatformPublicKeyCredentialAssertion
        else {
            throw PasskeyError.failed("Unexpected credential type.")
        }

        return try await api.completePasskeyAuthentication(
            credentialId: credential.credentialID.base64URLEncodedString(),
            authenticatorData: credential.rawAuthenticatorData.base64URLEncodedString(),
            signature: credential.signature.base64URLEncodedString(),
            clientDataJSON: credential.rawClientDataJSON.base64URLEncodedString(),
            userHandle: credential.userID.base64URLEncodedString()
        )
    }

    public func revoke(id: String) async throws {
        try await api.revokePasskey(id: id)
    }

    // MARK: Bridging the delegate API to async

    private func perform(
        _ requests: [ASAuthorizationRequest]
    ) async throws -> ASAuthorization {
        // One ceremony at a time. Overwriting `self.continuation` would abandon
        // the previous one un-resumed, and a continuation that is never resumed
        // does not fail — the task awaiting it hangs for the lifetime of the
        // process, so the first Face ID sheet would leave a spinner that never
        // stops. iOS will not present two authorization sheets at once anyway,
        // so refusing is both correct and the honest answer.
        guard continuation == nil else {
            throw PasskeyError.failed("Another passkey request is already in progress.")
        }

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: requests)
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    /// Resumes exactly once and clears the slot, so a delegate that fires twice
    /// (or fires both callbacks) cannot trip `CheckedContinuation`'s
    /// "resumed more than once" fatal error.
    private func finish(_ result: Result<ASAuthorization, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(with: result)
    }
}

extension PasskeyService: ASAuthorizationControllerDelegate {
    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        finish(.success(authorization))
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        // A user-cancelled ceremony is not a failure worth an alert, so it is
        // distinguished here rather than surfaced as an error string.
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            finish(.failure(PasskeyError.cancelled))
        } else {
            finish(.failure(PasskeyError.failed(error.localizedDescription)))
        }
    }
}

extension PasskeyService: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(
        for controller: ASAuthorizationController
    ) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.keyWindow ?? ASPresentationAnchor()
    }
}

// MARK: - base64url

/// WebAuthn uses base64URL, not standard base64. Feeding standard base64 to a
/// WebAuthn server produces a signature check that fails for no visible reason.
extension Data {
    init?(base64URLEncoded string: String) {
        var s = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        guard let data = Data(base64Encoded: s) else { return nil }
        self = data
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
