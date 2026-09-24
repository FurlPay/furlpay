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
    /// header) does not hit the keychain each time.
    ///
    /// THIS CACHE PARTLY DEFEATS `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`,
    /// AND THAT HAD TO BE SAID OUT LOUD. The accessibility attribute below
    /// promises that a locked device cannot hand the token to a background
    /// task. It only promises that about the KEYCHAIN. Once `get()` has run,
    /// the token is a plain `String` in the actor's memory and stays readable
    /// for as long as the process lives — including while the device is locked,
    /// which is exactly the window the attribute was chosen to close.
    ///
    /// `evictCache()` is the other half of the guarantee, and the app calls it
    /// when the protected data class becomes unavailable. Nothing here can
    /// enforce that on its own, hence the explicit entry point rather than a
    /// silent assumption that the cache is harmless.
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
        //
        // The gap between the two calls is real: if the add fails, the previous
        // token is already gone and the user is signed out by a save that was
        // meant to be a no-op refresh. It cannot be closed with a transaction —
        // the keychain has none — so it is closed by RESTORING on failure.
        var previous: AnyObject?
        var readQuery = baseQuery
        readQuery[kSecReturnData as String] = true
        readQuery[kSecMatchLimit as String] = kSecMatchLimitOne
        let hadPrevious = SecItemCopyMatching(readQuery as CFDictionary, &previous) == errSecSuccess

        SecItemDelete(baseQuery as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            // Put the old token back so a failed refresh costs nothing. Best
            // effort: if this also fails there is genuinely nothing left to do,
            // and the thrown error still tells the caller the save did not take.
            if hadPrevious, let data = previous as? Data {
                var restore = baseQuery
                restore[kSecValueData as String] = data
                restore[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
                SecItemAdd(restore as CFDictionary, nil)
            }
            throw KeychainError.saveFailed(status)
        }
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

    /// Drop the in-memory copy WITHOUT signing the user out.
    ///
    /// Called when the device locks (`UIApplication.protectedDataWillBecome
    /// Unavailable`), which is the moment the keychain item itself stops being
    /// readable. Without this the process keeps a usable bearer token in memory
    /// across the lock, so a background task that fires while the phone is in
    /// someone else's hands still authenticates — the precise scenario
    /// `WhenUnlocked` was chosen to prevent.
    ///
    /// Distinct from `clear()`: the item stays in the keychain, so the next
    /// `get()` after unlock reads it back and the session continues. Losing the
    /// cache costs one keychain round trip, not a sign-in.
    public func evictCache() {
        cached = nil
    }

    /// `self.` is required, not stylistic: inside a computed property Swift
    /// reads a bare `get` as the getter keyword and fails with
    /// "expected '{' to start getter definition". Qualifying it names the
    /// method instead.
    ///
    /// NOTE: this reports only that a token EXISTS. It is a UI hint, not an
    /// authorization check — the server authorizes every request, and
    /// FurlPayAPIClient clears the token on a 401.
    public var isSignedIn: Bool { self.get() != nil }
}
