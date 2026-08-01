//
//  SecurityPosture.swift
//
//  Port of native-app/lib/security.ts.
//
//  Pure, dependency-free posture logic so it is unit-testable and the Security
//  screen renders a level derived from REAL account signals, never a hardcoded
//  score. A security page that always says "Strong" is worse than no security
//  page — it teaches the user their account is fine when it may not be.
//

import Foundation

public struct SecuritySignals: Equatable, Sendable {
    /// At least one active passkey credential genuinely exists.
    public let passkey: Bool
    /// The account's email has been verified per the backend identity model.
    public let emailVerified: Bool
    /// The app's biometric lock is actually enabled.
    public let biometric: Bool

    public init(passkey: Bool, emailVerified: Bool, biometric: Bool) {
        self.passkey = passkey
        self.emailVerified = emailVerified
        self.biometric = biometric
    }
}

public enum SecurityLevel: String, Equatable, Sendable, CaseIterable {
    case strong, medium, weak

    public var label: String {
        switch self {
        case .strong: "Strong"
        case .medium: "Medium"
        case .weak:   "Weak"
        }
    }

    public var blurb: String {
        switch self {
        case .strong: "Your account is well protected."
        case .medium: "Add a passkey and app lock to fully protect your account."
        case .weak:   "Verify your email and add a passkey to protect your account."
        }
    }
}

public enum SecurityPosture {

    /// Derives the account's security level from authoritative signals only.
    ///
    ///   strong — passkey + verified email + biometric app lock
    ///   medium — verified email plus at least one strong protection
    ///   weak   — missing verified email, or email with neither protection
    ///
    /// Note that an unverified email is `weak` REGARDLESS of what else is on:
    /// account recovery runs through email, so an unverified one is a hole no
    /// amount of device-side protection closes.
    public static func level(_ s: SecuritySignals) -> SecurityLevel {
        if s.emailVerified && s.passkey && s.biometric { return .strong }
        if s.emailVerified && (s.passkey || s.biometric) { return .medium }
        return .weak
    }

    /// The specific things still missing, so the screen can list actions
    /// rather than just a grade.
    public static func gaps(_ s: SecuritySignals) -> [String] {
        var missing: [String] = []
        if !s.emailVerified { missing.append("Verify your email") }
        if !s.passkey { missing.append("Add a passkey") }
        if !s.biometric { missing.append("Turn on the app lock") }
        return missing
    }
}
