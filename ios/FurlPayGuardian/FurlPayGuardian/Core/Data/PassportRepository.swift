//
//  PassportRepository.swift
//
//  Port of native-app/lib/passport.ts, plus the gate that file does not have.
//
//  A GAP CARRIED FORWARD DELIBERATELY DIFFERENTLY FROM THE RN APP.
//
//  In native-app/, `app/passport.tsx` has no biometric gate at all — measured,
//  not assumed: zero LocalAuthentication calls across passport.tsx,
//  passport-scan.tsx, PassportCard.tsx and PassportCardStack.tsx. Card PAN
//  reveal IS gated there, and lib/biometrics.ts explains why: revealing a PAN is
//  sensitive-data ACCESS rather than an approval, so it stays gated regardless
//  of the user's "biometric approvals" preference.
//
//  A vault of government identity documents is sensitive-data access by exactly
//  that reasoning. So this port gates it, and gates it the same way — NOT
//  subject to the approvals toggle, because that toggle is about authorising
//  actions, not about who may look at a passport.
//
//  The lock is per-session and re-arms on background. Someone who hands over an
//  unlocked phone should not be handing over a document wallet.
//

import Foundation

@MainActor
@Observable
public final class PassportRepository {

    public private(set) var documents: [TravelDocument] = []
    public private(set) var isLoading = false
    public private(set) var loadError: String?

    /// Whether the vault is currently readable. Starts locked, always.
    public private(set) var isUnlocked = false

    private let api: FurlPayAPIClient
    private let biometrics: any BiometricGating

    public init(api: FurlPayAPIClient, biometrics: any BiometricGating) {
        self.api = api
        self.biometrics = biometrics
    }

    // MARK: The gate

    /// Unlocks the vault for this session.
    ///
    /// A failed or unavailable biometric leaves it LOCKED. Unlike an approval
    /// gate — where "no enrolled biometrics" reasonably means "let them
    /// through" — the absence of a biometric here is not permission to display
    /// someone's passport, it is a reason not to.
    @discardableResult
    public func unlock() async -> Bool {
        guard !isUnlocked else { return true }
        let result = await biometrics.authenticate(
            reason: "Unlock your document wallet"
        )
        isUnlocked = result.isAuthenticated
        return isUnlocked
    }

    /// Re-arms the lock. Called when the app backgrounds.
    public func lock() {
        isUnlocked = false
    }

    /// Wipes both the lock and the contents. Sign-out, not backgrounding.
    public func clear() {
        documents = []
        loadError = nil
        isUnlocked = false
    }

    // MARK: Reads

    public func refresh() async {
        // Refusing to fetch while locked keeps document data out of memory
        // until someone has proven they may see it.
        guard isUnlocked else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            documents = try await api.fetchTravelDocuments()
            loadError = nil
        } catch {
            loadError = "Couldn't load your documents."
        }
    }

    public var primary: TravelDocument? {
        documents.first { $0.isPrimary } ?? documents.first
    }

    /// Documents worth warning about, soonest first. Drives the dashboard nudge.
    public var needingAttention: [TravelDocument] {
        Self.documentsNeedingAttention(documents)
    }

    /// The filter as a pure function, so it can be tested without a repository,
    /// a keychain or a biometric prompt.
    ///
    /// `.pending` is deliberately NOT included: verification in progress is
    /// not a problem the user can act on, and nagging about it would teach them
    /// to ignore the badge that matters.
    nonisolated static func documentsNeedingAttention(
        _ documents: [TravelDocument]
    ) -> [TravelDocument] {
        documents
            .filter { $0.expired || $0.expiringSoon || $0.status == .failed }
            // ISO-8601 dates sort correctly as strings, which is the reason
            // `expiresOn` is kept in that form rather than parsed for display.
            .sorted { $0.expiresOn < $1.expiresOn }
    }

    // MARK: Verification

    public func beginScan(
        issuingCountry: String, documentType: String
    ) async throws -> PassportScanSession {
        try await api.initDocumentScan(
            issuingCountry: issuingCountry, documentType: documentType
        )
    }

    /// Tells the server the hosted flow finished. The SERVER decides the
    /// outcome; this call only reports that the user got to the end.
    public func completeVerification(sessionId: String) async throws -> TravelDocument {
        let document = try await api.completeDocumentVerification(sessionId: sessionId)
        await refresh()
        return document
    }

    // MARK: Mutations

    public func setPrimary(_ id: String) async throws {
        _ = try await api.updateTravelDocument(id: id, label: nil, isPrimary: true)
        await refresh()
    }

    public func rename(_ id: String, label: String) async throws {
        _ = try await api.updateTravelDocument(id: id, label: label, isPrimary: nil)
        await refresh()
    }

    /// Deleting requires a fresh biometric even inside an unlocked session.
    ///
    /// Unlocking is permission to LOOK. Destroying a verified document is a
    /// different question, and one an unattended unlocked phone should not be
    /// able to answer.
    public func delete(_ id: String) async throws {
        guard await biometrics.authenticate(
            reason: "Confirm removing this document"
        ).isAuthenticated else {
            throw APIError.notAuthenticated
        }
        try await api.deleteTravelDocument(id: id)
        await refresh()
    }
}
