//
//  PassportTests.swift
//
//  The vault holds government identity documents. Two things must hold: it
//  stays locked until someone proves they may look, and the client never
//  decides a verification outcome for itself.
//

import Testing
import Foundation
@testable import FurlPayGuardian

// MARK: - Test doubles

/// A gate whose answer the test chooses, and which records what it was asked.
///
/// `results` is consumed in order; once empty, `fallback` is returned forever.
/// That covers both "answer the same way every time" and "succeed then fail"
/// without two initialisers.
final class ScriptedBiometricGate: BiometricGating, @unchecked Sendable {
    private let lock = NSLock()
    private var pending: [BiometricResult]
    private let fallback: BiometricResult
    private var recorded: [String] = []

    init(results: [BiometricResult] = [], fallback: BiometricResult) {
        self.pending = results
        self.fallback = fallback
    }

    static func always(_ result: BiometricResult) -> ScriptedBiometricGate {
        ScriptedBiometricGate(fallback: result)
    }

    var prompts: [String] { lock.withLock { recorded } }
    var callCount: Int { lock.withLock { recorded.count } }

    var isAvailable: Bool { true }

    func authenticate(reason: String) async -> BiometricResult {
        lock.withLock {
            recorded.append(reason)
            return pending.isEmpty ? fallback : pending.removeFirst()
        }
    }
}

private func makeDocument(
    id: String = "doc-1",
    status: DocumentStatus = .verified,
    country: String = "GB",
    expired: Bool = false,
    expiringSoon: Bool = false,
    isPrimary: Bool = false
) -> TravelDocument {
    TravelDocument(
        id: id, type: "passport", typeLabel: "Passport",
        issuingCountry: country, countryName: "United Kingdom",
        documentNumberMasked: "•••• 4821", expiresOn: "2031-04-02",
        expiringSoon: expiringSoon, expired: expired, status: status,
        chipVerified: true, label: nil, isPrimary: isPrimary
    )
}

// MARK: - The lock

@Suite("Passport vault lock")
struct PassportVaultLockTests {

    @MainActor
    private func repository(_ gate: ScriptedBiometricGate) -> PassportRepository {
        PassportRepository(api: .shared, biometrics: gate)
    }

    @MainActor
    @Test("The vault starts locked")
    func startsLocked() {
        #expect(!repository(ScriptedBiometricGate.always(.authenticated)).isUnlocked)
    }

    @MainActor
    @Test("A successful biometric unlocks it")
    func unlocksOnSuccess() async {
        let repo = repository(ScriptedBiometricGate.always(.authenticated))
        #expect(await repo.unlock())
        #expect(repo.isUnlocked)
    }

    @MainActor
    @Test("A denied biometric leaves it locked")
    func staysLockedOnDenial() async {
        let repo = repository(ScriptedBiometricGate.always(.denied(reason: "cancelled")))
        #expect(await repo.unlock() == false)
        #expect(!repo.isUnlocked)
    }

    @MainActor
    @Test("No enrolled biometric leaves it LOCKED, unlike an approval gate")
    func unavailableIsNotPermission() async {
        // This is the deliberate difference from lib/biometrics.ts, where
        // "no hardware" reasonably means "let the action through". Absence of a
        // biometric is not permission to display someone's passport.
        let repo = repository(ScriptedBiometricGate.always(.unavailable(reason: "not enrolled")))
        #expect(await repo.unlock() == false)
        #expect(!repo.isUnlocked)
    }

    @MainActor
    @Test("Unlocking twice does not prompt twice")
    func unlockIsIdempotent() async {
        let gate = ScriptedBiometricGate.always(.authenticated)
        let repo = repository(gate)
        _ = await repo.unlock()
        _ = await repo.unlock()
        #expect(gate.callCount == 1)
    }

    @MainActor
    @Test("Locking re-arms the gate")
    func lockReArms() async {
        let gate = ScriptedBiometricGate.always(.authenticated)
        let repo = repository(gate)
        _ = await repo.unlock()
        repo.lock()
        #expect(!repo.isUnlocked)
        _ = await repo.unlock()
        #expect(gate.callCount == 2, "a re-locked vault must prompt again")
    }

    @MainActor
    @Test("Refreshing while locked fetches nothing")
    func noFetchWhileLocked() async {
        // Document data must not enter memory before someone has proven they
        // may see it.
        let repo = repository(ScriptedBiometricGate.always(.denied(reason: "no")))
        await repo.refresh()
        #expect(repo.documents.isEmpty)
    }

    @MainActor
    @Test("Deleting asks for a SECOND biometric inside an unlocked session")
    func deleteRequiresFreshAuth() async {
        // Unlocking is permission to look. Destroying a verified document is a
        // different question, and an unattended unlocked phone must not answer it.
        let gate = ScriptedBiometricGate(results: [.authenticated, .denied(reason: "cancelled")], fallback: .denied(reason: "cancelled"))
        let repo = repository(gate)
        _ = await repo.unlock()

        await #expect(throws: (any Error).self) {
            try await repo.delete("doc-1")
        }
        #expect(gate.callCount == 2)
        #expect(gate.prompts.last?.localizedCaseInsensitiveContains("removing") == true)
    }

    @MainActor
    @Test("Clearing wipes contents and re-locks")
    func clearWipes() async {
        let repo = repository(ScriptedBiometricGate.always(.authenticated))
        _ = await repo.unlock()
        repo.clear()
        #expect(!repo.isUnlocked)
        #expect(repo.documents.isEmpty)
    }
}

// MARK: - Outcome semantics

@Suite("Verification outcome")
struct PassportOutcomeTests {

    @Test("submitted is not approved — they are different cases")
    func submittedIsNotApproval() {
        // A dismissed sheet must never be readable as a pass. The provider
        // decides asynchronously and tells the SERVER.
        let submitted = PassportVerifyOutcome.submitted(sessionId: "s1")
        let dismissed = PassportVerifyOutcome.dismissed(sessionId: "s1")
        #expect(submitted != dismissed)
    }

    @Test("The outcome enum has no `approved` case")
    func noApprovedCase() {
        // Encoded as a test so adding one is a deliberate act with a failing
        // test attached, not a quiet convenience.
        switch PassportVerifyOutcome.submitted(sessionId: "s") {
        case .submitted, .dismissed, .unavailable:
            break   // exhaustive today; adding a case breaks this on purpose
        }
    }
}

// MARK: - Model

@Suite("Travel document")
struct TravelDocumentTests {

    @Test("Flags are derived from the ISO code", arguments: [
        ("GB", "🇬🇧"), ("US", "🇺🇸"), ("IN", "🇮🇳"), ("NL", "🇳🇱"),
    ])
    func flags(code: String, expected: String) {
        #expect(makeDocument(country: code).flag == expected)
    }

    @Test("A malformed country code degrades to a globe, not a crash")
    func badCodeIsSafe() {
        #expect(makeDocument(country: "").flag == "🌐")
        #expect(makeDocument(country: "XYZ").flag == "🌐")
        #expect(makeDocument(country: "1").flag == "🌐")
    }

    @Test("The model carries no field that could identify the holder")
    func noIdentifyingFields() throws {
        // The masked number is the only document data present, and it arrives
        // masked from the server. If this test starts failing because a name,
        // date of birth or image was added, that is the moment to stop.
        let encoded = try JSONEncoder().encode(makeDocument())
        let json = try #require(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        let forbidden = ["name", "givenName", "surname", "dateOfBirth", "dob",
                         "photo", "image", "mrz", "documentNumber", "fullNumber"]
        for key in forbidden {
            #expect(json[key] == nil, "\(key) must never be modelled client-side")
        }
        #expect(json["documentNumberMasked"] != nil)
    }

    @Test("Accessibility description names the country, type and status")
    func accessibilityCopy() {
        let description = makeDocument(isPrimary: true).accessibilityDescription
        #expect(description.contains("United Kingdom"))
        #expect(description.contains("Passport"))
        #expect(description.contains("verified"))
        #expect(description.contains("primary document"))
    }

    @Test("Expiry is surfaced in the accessibility description")
    func expiryAnnounced() {
        #expect(makeDocument(expired: true).accessibilityDescription.contains("expired"))
        #expect(makeDocument(expiringSoon: true)
            .accessibilityDescription.contains("expiring soon"))
    }

    @Test("Every status has a label and an icon")
    func statusesComplete() {
        for status in DocumentStatus.allCases {
            #expect(!status.label.isEmpty)
            #expect(!status.icon.isEmpty)
        }
    }

    @Test("Statuses decode from the server's lowercase wire form")
    func decodesWireForm() throws {
        for status in DocumentStatus.allCases {
            let json = Data("\"\(status.rawValue)\"".utf8)
            #expect(try JSONDecoder().decode(DocumentStatus.self, from: json) == status)
        }
    }
}

@Suite("Documents needing attention")
struct PassportAttentionTests {

    @Test("Expired, expiring and failed documents surface; healthy ones do not")
    func filtersCorrectly() {
        let docs = [
            makeDocument(id: "ok", status: .verified),
            makeDocument(id: "soon", status: .verified, expiringSoon: true),
            makeDocument(id: "gone", status: .expired, expired: true),
            makeDocument(id: "bad", status: .failed),
            makeDocument(id: "waiting", status: .pending),
        ]
        let ids = PassportRepository.documentsNeedingAttention(docs).map(\.id)
        #expect(Set(ids) == ["soon", "gone", "bad"])
        #expect(!ids.contains("ok"), "a healthy document is not a problem")
        #expect(!ids.contains("waiting"), "pending is in progress, not a failure")
    }

    @Test("Soonest expiry comes first, so the nudge names the urgent one")
    func sortedBySoonest() {
        var later = makeDocument(id: "later", expiringSoon: true)
        var sooner = makeDocument(id: "sooner", expiringSoon: true)
        later = TravelDocument(
            id: later.id, type: later.type, typeLabel: later.typeLabel,
            issuingCountry: later.issuingCountry, countryName: later.countryName,
            documentNumberMasked: later.documentNumberMasked, expiresOn: "2031-12-01",
            expiringSoon: true, expired: false, status: .verified,
            chipVerified: true, label: nil, isPrimary: false
        )
        sooner = TravelDocument(
            id: sooner.id, type: sooner.type, typeLabel: sooner.typeLabel,
            issuingCountry: sooner.issuingCountry, countryName: sooner.countryName,
            documentNumberMasked: sooner.documentNumberMasked, expiresOn: "2031-01-05",
            expiringSoon: true, expired: false, status: .verified,
            chipVerified: true, label: nil, isPrimary: false
        )
        let ordered = PassportRepository.documentsNeedingAttention([later, sooner])
        #expect(ordered.first?.id == "sooner")
    }

    @Test("An empty vault needs no attention")
    func emptyIsQuiet() {
        #expect(PassportRepository.documentsNeedingAttention([]).isEmpty)
    }
}
