//
//  TravelDocument.swift
//
//  Port of native-app/lib/passport.ts (TravelDocumentView) and
//  components/PassportCard.tsx.
//
//  THE ARCHITECTURAL RULE THIS FILE INHERITS, VERBATIM FROM THE RN APP:
//  there is no document upload and there never should be. The moment a
//  government ID photo touches this app's memory, our servers, our logs or our
//  backups, it is in scope for every biometric-data regime that applies to the
//  user — and we would be storing exactly the material an attacker wants most,
//  to do a job a specialist provider already does better.
//
//  So the only thing modelled here is what the SERVER returns: a masked number,
//  a status, and dates. No image, no MRZ, no full document number. If a field
//  is ever added to this struct that could identify the holder, that is the
//  moment to stop and reconsider.
//

import Foundation

/// Verification state. The server owns this — a client that decided its own
/// status would be a client an attacker can reconfigure.
public enum DocumentStatus: String, Codable, Sendable, CaseIterable {
    case pending, verified, failed, expired

    public var label: String {
        switch self {
        case .pending:  "PENDING"
        case .verified: "VERIFIED"
        case .failed:   "FAILED"
        case .expired:  "EXPIRED"
        }
    }

    public var icon: String {
        switch self {
        case .pending:  "clock"
        case .verified: "checkmark.shield.fill"
        case .failed:   "xmark.circle.fill"
        case .expired:  "exclamationmark.triangle.fill"
        }
    }
}

public struct TravelDocument: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let type: String
    public let typeLabel: String
    public let issuingCountry: String
    public let countryName: String
    /// Already masked by the server. The full number never reaches the client.
    public let documentNumberMasked: String
    public let expiresOn: String
    public let expiringSoon: Bool
    public let expired: Bool
    public let status: DocumentStatus
    /// NFC chip read succeeded during verification — a materially stronger
    /// signal than a photo of the page, and worth surfacing.
    public let chipVerified: Bool
    public let label: String?
    public let isPrimary: Bool

    public init(
        id: String, type: String, typeLabel: String,
        issuingCountry: String, countryName: String,
        documentNumberMasked: String, expiresOn: String,
        expiringSoon: Bool, expired: Bool, status: DocumentStatus,
        chipVerified: Bool, label: String?, isPrimary: Bool
    ) {
        self.id = id
        self.type = type
        self.typeLabel = typeLabel
        self.issuingCountry = issuingCountry
        self.countryName = countryName
        self.documentNumberMasked = documentNumberMasked
        self.expiresOn = expiresOn
        self.expiringSoon = expiringSoon
        self.expired = expired
        self.status = status
        self.chipVerified = chipVerified
        self.label = label
        self.isPrimary = isPrimary
    }

    /// Flag emoji from the ISO country code, computed rather than shipped as an
    /// asset catalogue of 200 flags.
    public var flag: String {
        let base: UInt32 = 0x1F1E6
        let code = issuingCountry.uppercased()
        guard code.count == 2 else { return "🌐" }
        var result = ""
        for scalar in code.unicodeScalars {
            guard let value = UnicodeScalar(base + scalar.value - 65) else { return "🌐" }
            result.unicodeScalars.append(value)
        }
        return result
    }

    /// What VoiceOver reads. The masked number is spoken as loose characters so
    /// it is not run together into a meaningless word.
    public var accessibilityDescription: String {
        [
            countryName,
            typeLabel,
            "ending \(documentNumberMasked.filter(\.isLetter) + documentNumberMasked.filter(\.isNumber))",
            status.label.lowercased(),
            isPrimary ? "primary document" : "",
            expired ? "expired" : (expiringSoon ? "expiring soon" : ""),
        ].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

// MARK: - Verification session

public struct PassportScanSession: Codable, Sendable {
    public let sessionId: String
    /// Provider-hosted URL. Opened in ASWebAuthenticationSession, never a
    /// WKWebView — see PassportVerificationFlow.
    public let sessionUrl: String
    public let documentFormat: String
}

/// How a verification attempt ended.
///
/// `submitted` is deliberately NOT `approved`. The browser closing tells us the
/// user finished the flow, nothing more — the provider decides the outcome
/// asynchronously and tells the SERVER. Treating a dismissed sheet as approval
/// would let anyone verify documents by swiping down.
public enum PassportVerifyOutcome: Equatable, Sendable {
    case submitted(sessionId: String)
    case dismissed(sessionId: String)
    case unavailable(reason: String)
}
