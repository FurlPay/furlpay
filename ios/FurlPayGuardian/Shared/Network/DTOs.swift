//
//  DTOs.swift
//
//  Wire types and their `toDomain()` mappings, mirroring
//  guardian/core/network/dto/Dtos.kt.
//
//  DTOs are kept separate from the domain models on purpose: the API is shared
//  with the web app and the Android client, and a field it renames should break
//  exactly one mapping function here rather than every view that reads a model.
//

import Foundation

// MARK: - Auth

struct OtpStartRequest: Encodable, Sendable {
    let phone: String
}

struct OtpCheckRequest: Encodable, Sendable {
    let phone: String
    let code: String
}

struct OtpCheckResponse: Decodable, Sendable {
    let token: String
}

// MARK: - Wallets

struct WalletDTO: Decodable, Sendable {
    let id: String
    let currency: String
    let balance: Decimal?
    let usdValue: Decimal?
    let chain: String?

    func toDomain() -> Wallet {
        Wallet(
            id: id,
            currency: currency,
            balance: balance ?? 0,
            usdValue: usdValue ?? 0,
            chain: chain
        )
    }
}

struct WalletsResponse: Decodable, Sendable {
    let wallets: [WalletDTO]
    let totalUsd: Decimal?

    func toDomain() -> WalletOverview {
        let mapped = wallets.map { $0.toDomain() }
        // Trust the server's total when it sends one; otherwise sum locally so
        // the dashboard is never blank because one field was omitted.
        return WalletOverview(
            totalUsd: totalUsd ?? mapped.reduce(Decimal.zero) { $0 + $1.usdValue },
            wallets: mapped
        )
    }
}

// MARK: - Cards

struct CardsResponse: Decodable, Sendable {
    let cards: [Card]
}

/// `freeze` is the field /api/cards/settings actually reads. It is `.optional()`
/// in the route's schema, so a misspelling is stripped silently and answered
/// 200 with an unchanged card rather than rejected — which is exactly what
/// `frozen` did here.
struct CardSettingsRequest: Encodable, Sendable {
    let cardId: String
    let freeze: Bool
}

struct CardSettingsResponse: Decodable, Sendable {
    let card: Card
}

// MARK: - Transactions

struct TransactionsResponse: Decodable, Sendable {
    let transactions: [Transaction]
}

// MARK: - Investing

struct PositionDTO: Decodable, Sendable {
    let symbol: String
    let name: String?
    let quantity: Decimal?
    let avgCost: Decimal?
    let currentPrice: Decimal?
    let marketValue: Decimal?
    let unrealizedPnl: Decimal?
    let unrealizedPnlPercent: Double?

    func toDomain() -> Position {
        Position(
            symbol: symbol,
            name: name ?? symbol,
            quantity: quantity ?? 0,
            avgCost: avgCost ?? 0,
            currentPrice: currentPrice ?? 0,
            marketValue: marketValue ?? 0,
            unrealizedPnl: unrealizedPnl ?? 0,
            unrealizedPnlPercent: unrealizedPnlPercent ?? 0
        )
    }
}

struct PortfolioResponse: Decodable, Sendable {
    let totalUsd: Decimal?
    let dayChangeUsd: Decimal?
    let dayChangePercent: Double?
    let positions: [PositionDTO]?

    func toDomain() -> PortfolioSummary {
        PortfolioSummary(
            totalUsd: totalUsd ?? 0,
            dayChangeUsd: dayChangeUsd ?? 0,
            dayChangePercent: dayChangePercent ?? 0,
            positions: (positions ?? []).map { $0.toDomain() }
        )
    }
}

/// `notional`, the name /api/investing/order's Zod schema declares. It requires
/// exactly one of `notional` or `qty`; `notionalUsd` was stripped and the route
/// 400'd with "Provide qty or notional".
struct OrderRequest: Encodable, Sendable {
    let symbol: String
    let side: String
    let notional: Decimal
}

public struct OrderResponse: Decodable, Sendable {
    public let orderId: String
    public let status: String
    public let filledQuantity: Decimal?
    public let averagePrice: Decimal?
}

// MARK: - Markets

struct MarketsResponse: Decodable, Sendable {
    let quotes: [MarketQuote]
}

struct BarsResponse: Decodable, Sendable {
    let candles: [Candle]
}

struct AssetDetailResponse: Decodable, Sendable {
    let symbol: String
    let name: String?
    let price: Decimal?
    let change24h: Double?
    let marketCap: Decimal?
    let volume24h: Decimal?
    let high24h: Decimal?
    let low24h: Decimal?
    let guardianScore: Int?
    let guardianVerdict: String?

    func toDomain() -> AssetDetail {
        AssetDetail(
            symbol: symbol,
            name: name ?? symbol,
            price: price ?? 0,
            change24h: change24h ?? 0,
            marketCap: marketCap,
            volume24h: volume24h,
            high24h: high24h,
            low24h: low24h,
            guardianScore: guardianScore,
            guardianVerdict: guardianVerdict
        )
    }
}

// MARK: - Travel

struct TripsResponse: Decodable, Sendable {
    let trips: [TravelBooking]
}

struct DealsResponse: Decodable, Sendable {
    let deals: [TravelDeal]
}

struct HotelsSearchResponse: Decodable, Sendable {
    let hotels: [HotelBooking]
}

struct FlightSearchRequest: Encodable, Sendable {
    let origin: String
    let destination: String
    let departDate: Date
}

struct FlightSearchResponse: Decodable, Sendable {
    let segments: [FlightSegment]
}

struct BookRequest: Encodable, Sendable {
    let offerId: String
    let idempotencyKey: String
}

struct BookResponse: Decodable, Sendable {
    let booking: TravelBooking
}

// MARK: - Push

struct RegisterDeviceRequest: Encodable, Sendable {
    let token: String
    let platform: String
    let client: String
}

public struct HotelOffer: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let name: String
    public let city: String?
    public let address: String?
    public let imageUrl: String?
    public let rating: Double?
    public let totalUsd: Decimal
    public let nights: Int?
    /// Defaulted rather than optional so the view never branches on nil for a
    /// list it only ever joins with separators.
    public let amenities: [String]

    enum CodingKeys: String, CodingKey {
        case id, name, city, address, imageUrl, rating, totalUsd, nights, amenities
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        city = try c.decodeIfPresent(String.self, forKey: .city)
        address = try c.decodeIfPresent(String.self, forKey: .address)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        rating = try c.decodeIfPresent(Double.self, forKey: .rating)
        totalUsd = try c.decode(Decimal.self, forKey: .totalUsd)
        nights = try c.decodeIfPresent(Int.self, forKey: .nights)
        amenities = try c.decodeIfPresent([String].self, forKey: .amenities) ?? []
    }
}

struct HotelSearchRequest: Encodable, Sendable {
    let destination: String
    let checkIn: String
    let checkOut: String
}

struct HotelSearchResponse: Decodable, Sendable {
    let offers: [HotelOffer]
}

// MARK: - Rewards, chains, insights, analytics, approvals, collections

public struct RewardEntry: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let reason: String
    public let points: Int
}

public struct RewardsOverview: Codable, Sendable, Hashable {
    public let points: Int
    public let tier: String
    public let history: [RewardEntry]
}

public struct ChainInfo: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let name: String
    public let enabled: Bool
    public let typicalFeeUsd: Decimal?
    public let finalitySeconds: Int?
}

public struct Insight: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let title: String
    public let detail: String
    public let severity: String
}

public struct CategorySlice: Identifiable, Codable, Sendable, Hashable {
    public var id: String { category }
    public let category: String
    public let amountUsd: Decimal
}

public struct AnalyticsOverview: Codable, Sendable, Hashable {
    public let spentUsd: Decimal
    public let receivedUsd: Decimal
    public let byCategory: [CategorySlice]
}

/// A pending action awaiting the user.
///
/// Carries a full `Confirmation` rather than loose fields precisely so
/// approving one goes through `GuardianActionRegistry` — the same validation an
/// AI-proposed action gets, which is what most of these are.
/// One pending 3DS2 out-of-band card approval, as returned by
/// GET /api/cards/challenges.
///
/// Note what it does NOT carry: a server-authored endpoint, method or body. The
/// shape this replaced (`PendingApproval`) embedded a whole `Confirmation`, so
/// the server named both the action and the amount and the app executed it. A
/// challenge is a fixed decision on a transaction the issuer already described
/// — approve or decline, nothing to steer.
public struct CardChallenge: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let amountUsd: Double
    public let currency: String
    public let merchant: String
    public let cardId: String?
    public let createdAt: Date?
    public let expiresAt: Date?
}

struct CardChallengesResponse: Decodable, Sendable {
    let challenges: [CardChallenge]
}

struct ChallengeDecisionRequest: Encodable, Sendable {
    let challengeId: String
    /// "approved" | "declined" — the route rejects anything else.
    let decision: String
}

struct ChainsResponse: Decodable, Sendable {
    let chains: [ChainInfo]
}

struct InsightsResponse: Decodable, Sendable {
    let insights: [Insight]
}

// MARK: - Support

public struct SupportTicket: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let subject: String
    public let status: String
    public let createdAt: Date?
    public let updatedAt: Date?
}

public struct SupportMessage: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    /// "user" or "agent". Compared case-insensitively at the call site because
    /// the server has used both casings.
    public let author: String
    public let body: String
    public let createdAt: Date?
}

struct SupportTicketsResponse: Decodable, Sendable {
    let tickets: [SupportTicket]
}

struct SupportMessagesResponse: Decodable, Sendable {
    let messages: [SupportMessage]
}

struct SupportReplyRequest: Encodable, Sendable {
    let body: String
}

// MARK: - Account and security

/// NOTE WHAT IS ABSENT: no `totpSecret`, no session secret, no full PII.
/// Per AGENTS.md rule 5 the server never returns those, so there is nothing to
/// model — and modelling them would create somewhere for them to land if the
/// server ever regressed.
public struct UserProfile: Codable, Sendable, Hashable {
    public let id: String
    public let email: String
    public let emailVerified: Bool
    public let displayName: String?
    public let uid: String?
    public let kycStatus: String?
    public let notifications: NotificationPreferences?
    public let security: SecurityFlags?

    public struct SecurityFlags: Codable, Sendable, Hashable {
        public let biometricEnabled: Bool?
        public let totpEnabled: Bool?
        public let loginAlerts: Bool?
        public let passkeyCount: Int?
    }
}

public struct NotificationPreferences: Codable, Sendable, Hashable {
    public var priceAlerts: Bool?
    public var productUpdates: Bool?
    public var loginAlerts: Bool?
}

struct UpdateProfileRequest: Encodable, Sendable {
    let displayName: String?
    let notifications: NotificationPreferences?
}

/// Relying-party identifier for passkeys. Must match the `webcredentials:`
/// domain in the app's associated-domains entitlement.
///
/// Declared in Shared rather than on PasskeyService because the decoder in
/// PasskeyRegistrationOptions below falls back to it, and this file compiles
/// into the watch target where PasskeyService does not exist. PasskeyService
/// re-exports it so existing phone call sites are unaffected.
public enum PasskeyConfig {
    public static let relyingParty = "furlpay.com"
}

/// Moved here from FurlPayGuardian/Features/Security/PasskeyService.swift.
/// That file belongs to the iPhone target alone, but this one compiles into
/// the watch target as well, so the watch build could not see the type the
/// two responses below decode into. A plain data type belongs with the DTOs;
/// PasskeyService keeps the AuthenticationServices work that is phone-only.
public struct PasskeyCredential: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let label: String?
    public let createdAt: Date?
    public let lastUsedAt: Date?
    public let deviceName: String?
}

struct PasskeysResponse: Decodable, Sendable {
    let credentials: [PasskeyCredential]
}

struct PasskeyCredentialResponse: Decodable, Sendable {
    let credential: PasskeyCredential
}

/// Server-issued and single-use. A client-chosen challenge would make the
/// attestation replayable.
public struct PasskeyRegistrationOptions: Decodable, Sendable {
    public let challenge: String
    public let userId: String
    public let relyingPartyId: String

    enum CodingKeys: String, CodingKey {
        case challenge, userId
        case relyingPartyId = "rpId"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        challenge = try c.decode(String.self, forKey: .challenge)
        userId = try c.decodeIfPresent(String.self, forKey: .userId) ?? ""
        // Falls back to the compiled-in relying party rather than failing:
        // authentication options legitimately omit it.
        relyingPartyId = try c.decodeIfPresent(String.self, forKey: .relyingPartyId)
            ?? PasskeyConfig.relyingParty
    }
}

struct CompletePasskeyRegistrationRequest: Encodable, Sendable {
    let credentialId: String
    let attestationObject: String
    let clientDataJSON: String
    let label: String
}

struct CompletePasskeyAuthRequest: Encodable, Sendable {
    let credentialId: String
    let authenticatorData: String
    let signature: String
    let clientDataJSON: String
    let userHandle: String
}

struct TokenResponse: Decodable, Sendable {
    let token: String
}

/// POST /api/auth/refresh.
///
/// `token` is optional on purpose: the server only puts it in the body for
/// clients whose `X-Furlpay-Client` starts with `mobile`, and a build that got
/// that header wrong should degrade to "could not refresh" rather than throwing
/// a decode error out of a background swap.
struct RefreshResponse: Decodable, Sendable {
    let refreshed: Bool?
    let token: String?
}

// MARK: - Money movement

struct TransferRequest: Encodable, Sendable {
    let destination: String
    let amountUsd: Decimal
    let asset: String
}

/// Quote phase of POST /api/swaps. Field names are the route's own
/// (`SwapQuoteSchema`): `fromAsset`/`amountUsd` were not in that schema, so
/// every quote request failed validation.
struct SwapQuoteRequest: Encodable, Sendable {
    let fromToken: String
    let toToken: String
    let fromChain: String
    let toChain: String?
    let amountIn: Decimal
    /// The route's discriminator. Explicit rather than omitted so the intent is
    /// on the wire and cannot be mistaken for the execute branch.
    let execute = false
}

/// Execute phase of POST /api/swaps.
///
/// Deliberately carries ONLY the discriminator and the quote id. Sending assets
/// and an amount here too would let a caller settle something other than what
/// was quoted, which is the exact failure the single-use id exists to prevent —
/// and the server ignores them for the same reason.
struct SwapExecuteRequest: Encodable, Sendable {
    let execute = true
    let quoteId: String
}

struct EarnDepositRequest: Encodable, Sendable {
    let vault: String
    let amountUsd: Decimal
}

struct BillsResponse: Decodable, Sendable {
    let bills: [Bill]
}

struct PayBillRequest: Encodable, Sendable {
    let billId: String
    let amountUsd: Decimal
}

struct OffRampRequest: Encodable, Sendable {
    let amountUsd: Decimal
    let to: String
    /// False asks for a quote only. The screen quotes and executes as two
    /// distinct steps so the user sees the rate before committing.
    let execute: Bool
}

struct OffRampResponse: Decodable, Sendable {
    let quote: FxQuote
}

// MARK: - Travel documents

/// The server returns `{ documents: [...] }` and `{ document: {...} }`, not
/// bare values. Unwrapping here rather than assuming the wrong shape is the
/// difference between a card that renders and one whose every field is nil.
struct DocumentsResponse: Decodable, Sendable {
    let documents: [TravelDocument]
}

struct DocumentResponse: Decodable, Sendable {
    let document: TravelDocument
}

struct InitScanRequest: Encodable, Sendable {
    let issuingCountry: String
    let documentType: String
}

struct VerifySessionRequest: Encodable, Sendable {
    let sessionId: String
}

struct UpdateDocumentRequest: Encodable, Sendable {
    let label: String?
    let isPrimary: Bool?
}

struct DeleteDocumentRequest: Encodable, Sendable {
    let confirmation: String
}

// MARK: - Apple Pay

/// `paymentData` is the base64 of PKPaymentToken.paymentData — opaque
/// ciphertext only the payment processor's key can open. `network` and
/// `displayName` ("Visa", "•••• 4242") are for the receipt, not for routing.
struct ApplePayTopUpRequest: Encodable, Sendable {
    let paymentData: String
    let network: String?
    let displayName: String?
    let amountUsd: Decimal
    let idempotencyKey: String
}
