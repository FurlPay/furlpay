//
//  GuardianPreferences.swift
//
//  Port of GuardianPreferences.kt (DataStore).
//
//  User preferences that are device-local BY DESIGN — not account state:
//  briefing hour and the budgets the spending coach compares against.
//
//  Secrets do NOT go here. The session token lives in KeychainTokenStore, and
//  UserDefaults is readable by anything that can read the app container.
//
//  Backed by the App Group suite so a complication can read the budget without
//  waking the app — and so it lives in Shared rather than the phone target,
//  because the watch's haptic setting is read here too.
//

import Foundation

@MainActor
@Observable
public final class GuardianPreferences {

    public static let shared = GuardianPreferences()

    private let defaults: UserDefaults

    private enum Key {
        static let briefingHour = "guardian.briefingHour"
        static let budgets = "guardian.budgets"
        static let hapticsEnabled = "guardian.hapticsEnabled"
        static let biometricApprovals = "guardian.biometricApprovals"
    }

    public static let defaultBriefingHour = 7

    init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: SnapshotCache.appGroup) ?? .standard
    }

    /// Local hour (0–23) the morning briefing fires.
    public var briefingHour: Int {
        get {
            // `object(forKey:)` rather than `integer(forKey:)`: the latter
            // returns 0 for "unset", which is a valid hour, so an unset
            // preference would silently mean midnight.
            guard let stored = defaults.object(forKey: Key.briefingHour) as? Int else {
                return Self.defaultBriefingHour
            }
            return min(max(stored, 0), 23)
        }
        set { defaults.set(min(max(newValue, 0), 23), forKey: Key.briefingHour) }
    }

    /// Budgets in USD keyed by `SpendingPeriod.wireName`. A non-positive budget
    /// is removed rather than stored — "budget of zero" and "no budget" are
    /// different states and only one of them is meaningful.
    public var budgets: [String: Decimal] {
        get {
            guard let raw = defaults.dictionary(forKey: Key.budgets) as? [String: Double]
            else { return [:] }
            return raw.compactMapValues { $0 > 0 ? Decimal($0) : nil }
        }
        set {
            let encoded = newValue.compactMapValues { value -> Double? in
                let double = NSDecimalNumber(decimal: value).doubleValue
                return double > 0 ? double : nil
            }
            defaults.set(encoded, forKey: Key.budgets)
        }
    }

    public func budget(for period: SpendingPeriod) -> Decimal? {
        budgets[period.wireName]
    }

    public func setBudget(_ amount: Decimal?, for period: SpendingPeriod) {
        var current = budgets
        if let amount, amount > 0 {
            current[period.wireName] = amount
        } else {
            current.removeValue(forKey: period.wireName)
        }
        budgets = current
    }

    /// Whether money-moving APPROVALS require Face ID.
    ///
    /// Defaults to ON, and "unset" must never mean "skip the check" — hence
    /// `object(forKey:)` rather than `bool(forKey:)`, which returns false for a
    /// missing key and would silently disable the gate on a fresh install.
    ///
    /// This governs APPROVALS ONLY. Sensitive-data ACCESS — the document
    /// wallet, bank details, card PAN reveal — stays gated regardless, the same
    /// norm Apple Wallet follows.
    public var biometricApprovals: Bool {
        get { defaults.object(forKey: Key.biometricApprovals) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Key.biometricApprovals) }
    }

    /// Watch haptics. On by default — the Wear OS build vibrates on
    /// confirmation and silence would read as a failed action.
    public var hapticsEnabled: Bool {
        get { defaults.object(forKey: Key.hapticsEnabled) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Key.hapticsEnabled) }
    }
}
