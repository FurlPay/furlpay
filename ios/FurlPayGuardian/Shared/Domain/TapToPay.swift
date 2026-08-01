//
//  TapToPay.swift
//
//  Domain types for Tap to Pay on iPhone — turning the merchant's iPhone into a
//  contactless terminal.
//
//  READ THIS BEFORE EXTENDING ANY OF IT.
//
//  Tap to Pay is NOT something an app developer can ship alone. Per Apple's
//  merchant terms, a merchant must be party to a PSP Agreement with a Payment
//  Service Provider that Apple has authorised, and the PSP — not us — is
//  responsible for onboarding, KYC, AML and underwriting. Apple's
//  `PaymentCardReaderSession` is created from a token the PSP issues; there is
//  no standalone path.
//
//  So the shape here is: FurlPay owns everything that is PSP-INDEPENDENT
//  (availability gating, Apple's mandatory merchant education, terms
//  acceptance, the UI, the ledger), and a `TapToPayProviding` conformance
//  supplies the rest. Nothing in this repo conforms to it yet, and
//  `UnconfiguredTapToPayProvider` fails closed — matching the deliberate
//  fail-closed posture the rest of the money layer already takes.
//
//  Also NOT true, and worth stating because it is the usual misconception: two
//  ordinary iPhones cannot tap each other to send money. One of them has to be
//  running an approved merchant terminal. The customer side is just Apple Pay,
//  a contactless card, a watch, or any other NFC wallet.
//

import Foundation

// MARK: - Why the terminal is unavailable

/// Every reason Tap to Pay might not be usable, in terms a merchant can act on.
///
/// Modelled explicitly rather than as a Bool because the remedies are entirely
/// different: "update iOS" is a two-minute fix, "this iPhone is too old" is a
/// purchase, and "not in your country" is neither.
public enum TapToPayUnavailability: Equatable, Sendable {
    /// iPhone XS is the floor — earlier hardware lacks the required Secure
    /// Element pathway.
    case deviceNotSupported
    case osTooOld
    /// Apple does not support Tap to Pay on iOS betas at all.
    case osIsBeta
    /// Region gating. Determined by the PSP, not guessed locally.
    case regionNotSupported(String?)
    /// The build has no entitlement, or Apple has not granted it.
    case notEntitled
    /// No PSP conformance is compiled in. The state this repo is in today.
    case noProvider
    /// The merchant has not accepted Apple's terms on this device yet.
    case termsNotAccepted
    /// The PSP has not finished onboarding this merchant.
    case merchantNotOnboarded(String?)

    public var title: String {
        switch self {
        case .deviceNotSupported:   "Not supported on this iPhone"
        case .osTooOld:             "Update required"
        case .osIsBeta:             "Not available on beta iOS"
        case .regionNotSupported:   "Not available in your region"
        case .notEntitled:          "Not enabled for this app"
        case .noProvider:           "Card acceptance isn't set up"
        case .termsNotAccepted:     "One more step"
        case .merchantNotOnboarded: "Finish setting up payments"
        }
    }

    public var detail: String {
        switch self {
        case .deviceNotSupported:
            "Accepting contactless payments needs iPhone XS or later."
        case .osTooOld:
            "Update to the latest iOS to accept contactless payments."
        case .osIsBeta:
            "Apple doesn't support contactless acceptance on beta versions of iOS."
        case .regionNotSupported(let region):
            region.map { "Contactless acceptance isn't available in \($0) yet." }
                ?? "Contactless acceptance isn't available in your region yet."
        case .notEntitled:
            "This build isn't authorised to accept contactless payments."
        case .noProvider:
            "Connect a payment processor to start accepting cards."
        case .termsNotAccepted:
            "Accept Apple's Tap to Pay terms to start taking payments."
        case .merchantNotOnboarded(let reason):
            reason ?? "Your payment account is still being verified."
        }
    }

    /// Whether showing the merchant a retry button is honest. Offering "try
    /// again" for hardware that will never support it is just cruelty.
    public var isRecoverable: Bool {
        switch self {
        case .deviceNotSupported, .regionNotSupported, .notEntitled:
            false
        case .osTooOld, .osIsBeta, .noProvider, .termsNotAccepted, .merchantNotOnboarded:
            true
        }
    }
}

public enum TapToPayAvailability: Equatable, Sendable {
    case available
    case unavailable(TapToPayUnavailability)

    public var isAvailable: Bool { self == .available }
}

// MARK: - A charge

/// One amount to collect. Deliberately minimal — a tip, a discount or a line
/// item is the merchant app's business, and none of it changes what gets tapped.
public struct TapToPayCharge: Equatable, Sendable {
    public let amount: Decimal
    public let currencyCode: String
    /// Shown on the tap sheet so the customer sees what they are paying for.
    public let reference: String?
    /// Generated once per charge and reused across retries. A fresh key per
    /// attempt is how a flaky network turns one sale into three.
    public let idempotencyKey: String

    public init(
        amount: Decimal,
        currencyCode: String = "USD",
        reference: String? = nil,
        idempotencyKey: String = UUID().uuidString
    ) {
        self.amount = amount
        self.currencyCode = currencyCode
        self.reference = reference
        self.idempotencyKey = idempotencyKey
    }

    /// Minor units, which is what every card network and PSP actually wants.
    /// Rounding is explicit and banker's-free: half-up, matching how a till
    /// rounds.
    public var minorUnits: Int {
        var source = amount * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &source, 0, .plain)
        return NSDecimalNumber(decimal: rounded).intValue
    }

    /// Guards the two ends a terminal must never accept. The upper bound is a
    /// deliberate policy ceiling, not a network limit — a mistyped amount is
    /// far more likely than a genuine six-figure tap.
    public var isValid: Bool {
        amount > 0 && amount <= 10_000
    }
}

public struct TapToPayResult: Equatable, Sendable {
    public let transactionId: String
    public let amount: Decimal
    public let currencyCode: String
    /// "Visa •••• 4242" — for the receipt, never for routing.
    public let cardDescription: String?
    public let completedAt: Date

    public init(
        transactionId: String, amount: Decimal, currencyCode: String,
        cardDescription: String?, completedAt: Date = Date()
    ) {
        self.transactionId = transactionId
        self.amount = amount
        self.currencyCode = currencyCode
        self.cardDescription = cardDescription
        self.completedAt = completedAt
    }
}

public enum TapToPayError: Error, Equatable, Sendable {
    case unavailable(TapToPayUnavailability)
    case invalidAmount
    /// The customer moved the card away, or removed it too early.
    case cardReadFailed(String)
    /// The issuer said no. Not our failure, and the copy should not imply it is.
    case declined(String?)
    case cancelled
    case network(String)
    case providerFailure(String)

    public var isCancellation: Bool { self == .cancelled }
}

// MARK: - The PSP seam

/// What a Payment Service Provider must supply.
///
/// Everything below the tap: the reader session, the terms sheet, the card
/// read, and the authorisation. Apple's `PaymentCardReaderSession` is created
/// from a PSP-issued token, so this cannot be implemented without one — see the
/// file header.
public protocol TapToPayProviding: Sendable {
    /// The PSP's own view of whether this merchant can transact right now:
    /// onboarding complete, region supported, terminal configuration loaded.
    func availability() async -> TapToPayAvailability

    /// Presents Apple's terms-and-conditions sheet. Accepted once per merchant
    /// identifier — a second device for the same merchant does not re-prompt.
    func acceptTermsIfNeeded() async throws

    /// Collects one payment. Presents the system tap sheet and returns when the
    /// customer's card, phone or watch has been read and authorised.
    func collect(_ charge: TapToPayCharge) async throws -> TapToPayResult
}

/// The conformance in force today: there is no PSP, so nothing can be taken.
///
/// Fails closed on purpose. A stub that returned a fake success would let a
/// merchant believe they had been paid, which is the single worst outcome
/// available in this feature.
public struct UnconfiguredTapToPayProvider: TapToPayProviding {
    public init() {}

    public func availability() async -> TapToPayAvailability {
        .unavailable(.noProvider)
    }

    public func acceptTermsIfNeeded() async throws {
        throw TapToPayError.unavailable(.noProvider)
    }

    public func collect(_ charge: TapToPayCharge) async throws -> TapToPayResult {
        throw TapToPayError.unavailable(.noProvider)
    }
}
