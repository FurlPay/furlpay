//
//  BiometricGate.swift
//
//  iOS equivalent of guardian/core/security BiometricGate (BiometricPrompt with
//  BIOMETRIC_STRONG). Every state-changing API call passes through this first.
//
//  The gate is a protocol so the watch target can supply a different
//  implementation. Apple Watch has no Face ID or Touch ID, and wrist detection
//  is not an authentication factor — so `UnavailableBiometricGate` denies
//  everything and the watch either relays the action to the phone or uses the
//  two-step manual confirmation the Wear OS app already uses for orders.
//

import Foundation
#if canImport(LocalAuthentication)
import LocalAuthentication
#endif

public enum BiometricResult: Sendable, Equatable {
    case authenticated
    /// The user cancelled, or failed to authenticate.
    case denied(reason: String)
    /// No biometric hardware, or none enrolled. The caller decides whether a
    /// passcode fallback is acceptable for this particular action.
    case unavailable(reason: String)

    public var isAuthenticated: Bool { self == .authenticated }
}

public protocol BiometricGating: Sendable {
    func authenticate(reason: String) async -> BiometricResult
    var isAvailable: Bool { get }
}

#if canImport(LocalAuthentication) && !os(watchOS)

public struct BiometricGate: BiometricGating {

    /// When true, a device passcode is accepted if biometrics are unavailable.
    /// Off by default: an action worth gating is worth gating properly, and a
    /// passcode is materially weaker than Face ID for shoulder-surfing.
    private let allowPasscodeFallback: Bool

    public init(allowPasscodeFallback: Bool = false) {
        self.allowPasscodeFallback = allowPasscodeFallback
    }

    private var policy: LAPolicy {
        allowPasscodeFallback
            ? .deviceOwnerAuthentication
            : .deviceOwnerAuthenticationWithBiometrics
    }

    public var isAvailable: Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(policy, error: &error)
    }

    public func authenticate(reason: String) async -> BiometricResult {
        // A fresh context per call. Reusing one lets a previous successful
        // evaluation satisfy a later call within `touchIDAuthenticationAllowableReuseDuration`,
        // which would mean the second transfer of the session is not actually
        // authenticated by the user.
        let context = LAContext()
        context.localizedFallbackTitle = allowPasscodeFallback ? "Use Passcode" : ""

        var error: NSError?
        guard context.canEvaluatePolicy(policy, error: &error) else {
            return .unavailable(reason: error?.localizedDescription ?? "Biometrics unavailable.")
        }

        do {
            let ok = try await context.evaluatePolicy(policy, localizedReason: reason)
            return ok ? .authenticated : .denied(reason: "Authentication failed.")
        } catch let laError as LAError {
            return switch laError.code {
            case .userCancel, .appCancel, .systemCancel:
                .denied(reason: "Cancelled.")
            case .userFallback:
                .denied(reason: "Fallback declined.")
            case .biometryNotAvailable, .biometryNotEnrolled:
                .unavailable(reason: laError.localizedDescription)
            case .biometryLockout:
                .unavailable(reason: "Biometrics are locked out. Unlock with your passcode.")
            default:
                .denied(reason: laError.localizedDescription)
            }
        } catch {
            return .denied(reason: error.localizedDescription)
        }
    }
}

#endif

/// The watch's gate, and the gate used by any background context with no UI.
///
/// Two distinct cases collapse to the same answer:
///   1. Apple Watch has no biometric sensor at all.
///   2. A background voice relay has no visible scene, so there is nowhere to
///      present a prompt — matching the Android rule that `VoiceRelayService`
///      running without an Activity rejects every mutating tool call.
public struct UnavailableBiometricGate: BiometricGating {
    private let reason: String

    public init(reason: String = "This device cannot confirm with biometrics.") {
        self.reason = reason
    }

    public var isAvailable: Bool { false }

    public func authenticate(reason _: String) async -> BiometricResult {
        .unavailable(reason: reason)
    }
}
