//
//  ActionStepUpService.swift
//
//  Turns "the user approved this" from a local Bool into something the server
//  can check.
//
//  THE DEFECT
//
//  `ServiceContainer.confirmAndDispatch` gates every money-moving action behind
//  `BiometricGate`, which asks LocalAuthentication and returns a Bool. That Bool
//  never left the device, and the seven endpoints Guardian can dispatch to
//  enforced nothing — no step-up, no proof, no MFA. A bearer token alone placed a
//  $25,000 order. The Face ID sheet was a local courtesy, and a patched client, a
//  stolen token or a replayed request skipped it without leaving a trace that it
//  had been skipped.
//
//  WHAT REPLACES IT, FOR MONEY
//
//  A WebAuthn assertion over a server-issued challenge committed to the exact
//  request. The Secure Enclave signs; the server verifies and returns a
//  single-use proof valid for 120 seconds; the executing route re-derives the
//  digest from the request it actually received and refuses anything else.
//
//  ONE PROMPT, NOT TWO. This REPLACES the LocalAuthentication prompt for money
//  actions rather than being added on top of it. The assertion already required
//  the user to present Face ID — the server sets `userVerification: "required"`
//  — so asking LAContext first would show the same person the same sheet twice
//  for one approval, and the second prompt would be the one that proved nothing.
//
//  WHAT HAPPENS WITHOUT A PASSKEY
//
//  `.unavailable`, which the caller treats exactly like the biometric gate's
//  `.unavailable`: fall back to the local prompt, and let the SERVER decide.
//  Below the step-up threshold the request proceeds; at or above it the route
//  returns 401 `stepUpRequired` and nothing moves. That is the fail-closed
//  direction, and it is why the client deliberately does NOT carry a copy of the
//  threshold: a number duplicated on both sides is a number that eventually
//  disagrees, and the disagreement that matters is the client believing no proof
//  is needed.
//

import Foundation

public enum ActionStepUpResult: Sendable {
    /// A single-use proof to attach to the request.
    case proved(proofId: String)
    /// The user declined or cancelled the ceremony. NOT a fallback case.
    case declined(reason: String)
    /// No passkey, or the ceremony could not run. The caller falls back to the
    /// local gate and lets the server enforce the threshold.
    case unavailable(reason: String)
}

@MainActor
public final class ActionStepUpService {

    private let api: FurlPayAPIClient
    private let passkeys: PasskeyService

    public init(api: FurlPayAPIClient, passkeys: PasskeyService) {
        self.api = api
        self.passkeys = passkeys
    }

    /// Runs the full ceremony for one action.
    ///
    /// The body passed here MUST be the body that will be sent, minus the proof
    /// field — the digest is committed over it and the server re-derives from
    /// what arrives. Attaching the proof is the dispatcher's job precisely so
    /// this function cannot be handed a body it did not commit to.
    public func prove(
        endpoint: String,
        method: String,
        body: [String: JSONValue]
    ) async -> ActionStepUpResult {
        let intent = ActionStepUpIntent(endpoint: endpoint, method: method, body: body)

        let challenge: ActionStepUpChallenge
        do {
            challenge = try await api.beginActionStepUp(intent)
        } catch {
            // The expected case is "no passkeys registered". Treated as
            // unavailable rather than declined: the user did not refuse anything,
            // and the server still holds the line on value.
            return .unavailable(reason: error.localizedDescription)
        }

        let assertion: WebAuthnAssertionPayload
        do {
            assertion = try await passkeys.assertion(
                challengeBase64URL: challenge.options.challenge,
                relyingPartyId: challenge.options.rpId
            )
        } catch PasskeyError.cancelled {
            // A cancelled Face ID sheet is a REFUSAL. Returning `.unavailable`
            // here would let the caller fall back to the local prompt and ask
            // again, turning "no" into "are you sure?" — and, below the
            // threshold, into an approval the user actively declined to give.
            return .declined(reason: "Not confirmed.")
        } catch {
            return .declined(reason: error.localizedDescription)
        }

        do {
            let proof = try await api.completeActionStepUp(
                challengeId: challenge.challengeId,
                assertion: assertion
            )
            guard proof.verified, !proof.proofId.isEmpty else {
                return .declined(reason: "That approval could not be verified.")
            }
            return .proved(proofId: proof.proofId)
        } catch {
            // The signature was produced but the server refused it. Declined, not
            // unavailable: falling back to a local prompt after the server has
            // rejected the evidence would be substituting the weaker check for
            // the one that just failed.
            return .declined(reason: "That approval could not be verified.")
        }
    }
}
