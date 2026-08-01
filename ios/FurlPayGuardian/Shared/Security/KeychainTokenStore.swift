//
//  KeychainTokenStore.swift
//
//  iOS equivalent of guardian/core/security KeystoreTokenStore (AndroidKeyStore
//  AES-256/GCM). Keychain gives the same property without hand-rolled crypto:
//  the item is encrypted at rest by the Secure Enclave on devices that have one.
//
//  An `actor` rather than a class: the token is read by the network layer off
//  the main thread, written by the sign-in flow on it, and pushed to the watch
//  from a background task. Under Swift 6 strict concurrency that is three
//  isolation domains touching one mutable value, which is exactly what actors
//  exist for.
//

import Foundation
import Security

public enum KeychainError: Error, LocalizedError, Sendable {
    case saveFailed(OSStatus)
    case unexpectedData
    case accessControlFailed

    public var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            "Could not save to the keychain (OSStatus \(status))."
        case .unexpectedData:
            "The keychain returned data in an unexpected format."
        case .accessControlFailed:
            "Could not create the keychain access policy."
        }
    }
}

public actor KeychainTokenStore {

    public static let shared = KeychainTokenStore()

    private let service: String
    private let account = "auth_token"

    /// In-memory copy so a hot path (every API request adds an Authorization
    /// header) does not hit the keychain each time. Cleared on `clear()`.
    private var cached: String?

    public init(service: String = "com.furlpay.guardian") {
        self.service = service
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    /// Store the JWT.
    ///
    /// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` on purpose:
    ///   - *WhenUnlocked* — a locked device should not be able to hand the token
    ///     to a background task.
    ///   - *ThisDeviceOnly* — the token must not travel in an iCloud Keychain
    ///     backup and reappear on a restored device the user no longer holds.
    ///
    /// Note this deliberately does NOT set `.biometryCurrentSet` on the token
    /// itself. Biometrics gate *mutating operations* through `BiometricGate`;
    /// putting them on the token would prompt for Face ID on every background
    /// refresh, which trains the user to approve prompts reflexively — the
    /// opposite of what the gate is for.
    public func save(_ token: String) throws {
        let data = Data(token.utf8)

        var query = baseQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

        // Delete-then-add rather than update: SecItemUpdate cannot change
        // accessibility attributes, so an item written by an older build would
        // silently keep its old policy.
        SecItemDelete(baseQuery as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.saveFailed(status) }
        cached = token
    }

    public func get() -> String? {
        if let cached { return cached }

        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        cached = token
        return token
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
        cached = nil
    }

    public var isSignedIn: Bool { get() != nil }
}
