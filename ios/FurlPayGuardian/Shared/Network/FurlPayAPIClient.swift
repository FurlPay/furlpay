//
//  FurlPayAPIClient.swift
//
//  iOS equivalent of guardian/core/network FurlPayClient + FurlPayApi.
//  Endpoints below were read out of the Kotlin @GET/@POST annotations rather
//  than transcribed from a document, so the two clients cannot drift.
//
//  Shared by the iPhone app and the Watch app. The watch talks to the same API
//  directly as a fallback when the phone is unreachable — snapshots from
//  WatchConnectivity are the fast path, not the only path.
//

import Foundation

// MARK: - Errors

public enum APIError: Error, LocalizedError, Sendable {
    case notAuthenticated
    case http(status: Int, body: String?)
    case decoding(String)
    case transport(String)
    case cancelled
    /// The top-up route is not deployed. Distinct from a 404 so the UI can say
    /// so plainly instead of showing a status code for a payment the user just
    /// authorised.
    case applePayUnavailable

    public var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            "You are signed out."
        case .http(let status, let body):
            if let body, !body.isEmpty { "Server error \(status): \(body)" }
            else { "Server error \(status)." }
        case .decoding(let detail):
            "Could not read the server response: \(detail)"
        case .transport(let detail):
            detail
        case .cancelled:
            "Cancelled."
        case .applePayUnavailable:
            "Apple Pay top-up isn't available yet. Nothing was charged."
        }
    }

    /// Retrying a 4xx with the same body produces the same 4xx. Only transport
    /// failures and 5xx are worth a second attempt.
    public var isRetryable: Bool {
        switch self {
        case .transport: true
        case .http(let status, _): status >= 500
        default: false
        }
    }
}

// MARK: - Client

public actor FurlPayAPIClient {

    public static let shared = FurlPayAPIClient()

    private let baseURL: URL
    private let session: URLSession
    private let tokenStore: KeychainTokenStore
    private let clientHeader: String

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .useDefaultKeys   // DTOs spell their own keys
        d.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            // The API emits ISO-8601 both with and without fractional seconds
            // depending on the route; a single formatter rejects half of them.
            if let date = ISO8601DateFormatter.withFractionalSeconds.date(from: text) {
                return date
            }
            if let date = ISO8601DateFormatter.standard.date(from: text) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Unrecognised date '\(text)'"
            )
        }
        return d
    }()

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    /// MUST start with "mobile".
    ///
    /// This is not cosmetic and it is not a version string the server ignores.
    /// `apps/web/src/lib/clientKind.ts` returns the session JWT in the response
    /// BODY only for clients whose `X-Furlpay-Client` starts with `mobile`;
    /// everything else is treated as a browser and gets an HttpOnly cookie it
    /// cannot read. With the header set to `ios-guardian/…`, /auth/otp/check and
    /// /auth/passkey/authenticate both returned a body with no `token` field,
    /// so sign-in failed at the decode step every single time.
    public static let defaultClientHeader = "mobile-ios-guardian/1.0.0"

    /// Swap the token when it has less than this left. Matches REFRESH_MARGIN_MS
    /// in native-app/lib/api.ts and FurlPayClient.kt.
    private static let refreshMargin: TimeInterval = 10 * 60

    public init(
        baseURL: URL = URL(string: "https://furlpay.com/api/")!,
        session: URLSession = .shared,
        tokenStore: KeychainTokenStore = .shared,
        clientHeader: String = FurlPayAPIClient.defaultClientHeader
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenStore = tokenStore
        self.clientHeader = clientHeader
    }

    // MARK: Sliding session refresh
    //
    // The session JWT lives an hour. Without this the first call after expiry
    // 401s, `send` clears the keychain, and the user is dropped onto the login
    // screen mid-use — which is what the RN and Android clients each added a
    // refresh to avoid.
    //
    // Single-flight comes free here: this is an actor, so a burst of parallel
    // requests serialises on `refreshIfExpiring` and everyone after the first
    // re-reads a token that is no longer near expiry and returns immediately.

    /// `exp` (in seconds) from a JWT without verifying it. The server verifies
    /// properly; this only needs a clock to schedule the swap.
    static func expiry(of token: String) -> Date? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        guard let data = Data(base64Encoded: base64),
              let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = claims["exp"] as? Double
        else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    private func refreshIfExpiring() async {
        guard let token = await tokenStore.get(), let exp = Self.expiry(of: token) else { return }
        guard exp.timeIntervalSinceNow <= Self.refreshMargin else { return }

        var request = URLRequest(url: baseURL.appendingPathComponent("auth/refresh"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(clientHeader, forHTTPHeaderField: "X-Furlpay-Client")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        // Failure is deliberately not fatal and deliberately not surfaced:
        // offline, already expired, or past the server's 30-day ceiling all end
        // the same way — the caller proceeds with the old token and the normal
        // 401 path decides what happens next.
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let refreshed = try? decoder.decode(RefreshResponse.self, from: data),
              let newToken = refreshed.token
        else { return }
        try? await tokenStore.save(newToken)
    }

    // MARK: Request plumbing

    /// Percent-encodes one interpolated path segment.
    ///
    /// `appendingPathComponent` does not collapse `..`, so a slug or id taken
    /// from a deep link, a scanned code or a server payload could otherwise
    /// walk out of /api and address a different route entirely.
    static func segment(_ raw: String) -> String {
        raw.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(.init(charactersIn: "-._~")))
            ?? ""
    }

    private func makeRequest(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: (Encodable & Sendable)? = nil,
        authenticated: Bool = true,
        idempotencyKey: String? = nil
    ) async throws -> URLRequest {
        // Swap an about-to-expire token BEFORE using it (no-op with >10 min left).
        if authenticated { await refreshIfExpiring() }

        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            components.queryItems = query
                .sorted { $0.key < $1.key }        // stable, so caches key alike
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }

        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(clientHeader, forHTTPHeaderField: "X-Furlpay-Client")

        if authenticated {
            guard let token = await tokenStore.get() else { throw APIError.notAuthenticated }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }
        return request
    }

    private func send<T: Decodable & Sendable>(_ request: URLRequest, as _: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw APIError.cancelled
        } catch {
            throw APIError.transport(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("Malformed response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            // 401 clears the token: the session is gone and every later request
            // would fail the same way until the user signs in again.
            if http.statusCode == 401 { await tokenStore.clear() }
            throw APIError.http(
                status: http.statusCode,
                body: String(data: data.prefix(512), encoding: .utf8)
            )
        }

        // A 204, or a 200 with no body, is a success. Handing empty Data to
        // JSONDecoder throws "unexpected end of file", which would turn every
        // successful DELETE into a reported failure.
        if data.isEmpty, let empty = EmptyResponse() as? T { return empty }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    // MARK: - Auth

    public func otpStart(phone: String) async throws {
        let request = try await makeRequest(
            "POST", "auth/otp/start",
            body: OtpStartRequest(phone: phone),
            authenticated: false
        )
        _ = try await send(request, as: EmptyResponse.self)
    }

    /// Returns the JWT. The caller is responsible for storing it — this client
    /// does not write the keychain as a side effect of a network call.
    public func otpCheck(phone: String, code: String) async throws -> String {
        let request = try await makeRequest(
            "POST", "auth/otp/check",
            body: OtpCheckRequest(phone: phone, code: code),
            authenticated: false
        )
        return try await send(request, as: OtpCheckResponse.self).token
    }

    // MARK: - Wallets, cards, transactions

    public func fetchWallets() async throws -> WalletOverview {
        try await send(try await makeRequest("GET", "wallets"), as: WalletsResponse.self).toDomain()
    }

    public func fetchCards() async throws -> [Card] {
        try await send(try await makeRequest("GET", "cards"), as: CardsResponse.self).cards
    }

    /// Mutating — callers MUST pass a successful `BiometricGate` result.
    ///
    /// The wire field is `freeze`, not `frozen`. /api/cards/settings declares it
    /// optional, so the wrong spelling was stripped by the route's Zod schema
    /// and answered 200 with an unchanged card: a freeze that reported success
    /// and left the card live.
    public func updateCardSettings(cardId: String, frozen: Bool) async throws -> Card {
        let request = try await makeRequest(
            "POST", "cards/settings",
            body: CardSettingsRequest(cardId: cardId, freeze: frozen)
        )
        return try await send(request, as: CardSettingsResponse.self).card
    }

    public func fetchTransactions() async throws -> [Transaction] {
        try await send(
            try await makeRequest("GET", "transactions"), as: TransactionsResponse.self
        ).transactions
    }

    // MARK: - Investing

    public func fetchPortfolio() async throws -> PortfolioSummary {
        try await send(
            try await makeRequest("GET", "investing/portfolio"), as: PortfolioResponse.self
        ).toDomain()
    }

    /// Mutating.
    ///
    /// The wire field is `notional`. /api/investing/order requires exactly one
    /// of `notional` or `qty` and 400s with "Provide qty or notional" when
    /// neither survives validation, which is what `notionalUsd` did.
    public func placeOrder(symbol: String, side: String, notionalUsd: Decimal) async throws -> OrderResponse {
        let request = try await makeRequest(
            "POST", "investing/order",
            body: OrderRequest(symbol: symbol, side: side, notional: notionalUsd)
        )
        return try await send(request, as: OrderResponse.self)
    }

    // MARK: - Markets

    public func fetchMarkets(kind: String? = nil, limit: Int? = nil, sort: String? = nil) async throws -> [MarketQuote] {
        var query: [String: String] = [:]
        if let kind { query["kind"] = kind }
        if let limit { query["limit"] = String(limit) }
        if let sort { query["sort"] = sort }
        return try await send(
            try await makeRequest("GET", "markets", query: query), as: MarketsResponse.self
        ).quotes
    }

    public func fetchBars(symbol: String, timeframe: String) async throws -> [Candle] {
        try await send(
            try await makeRequest("GET", "markets/bars", query: ["symbol": symbol, "tf": timeframe]),
            as: BarsResponse.self
        ).candles
    }

    public func fetchAssetDetail(symbol: String) async throws -> AssetDetail {
        try await send(
            try await makeRequest("GET", "markets/\(Self.segment(symbol))"),
            as: AssetDetailResponse.self
        ).toDomain()
    }

    // MARK: - Travel

    public func fetchTrips() async throws -> [TravelBooking] {
        try await send(try await makeRequest("GET", "travel/trips"), as: TripsResponse.self).trips
    }

    public func fetchDeals() async throws -> [TravelDeal] {
        try await send(try await makeRequest("GET", "travel/deals"), as: DealsResponse.self).deals
    }

    /// Flight boarding passes. Session-scoped server-side: the route derives the
    /// owner from the token and never from a parameter, so there is no user id
    /// to pass and no way for this client to ask for someone else's seat.
    public func fetchBoardingPasses() async throws -> [BoardingPass] {
        try await send(
            try await makeRequest("GET", "travel/boarding-passes"),
            as: BoardingPassesResponse.self
        ).passes
    }

    public func searchHotels(city: String) async throws -> [HotelBooking] {
        try await send(
            try await makeRequest("GET", "travel/hotels", query: ["city": city]),
            as: HotelsSearchResponse.self
        ).hotels
    }

    public func searchFlights(origin: String, destination: String, departDate: Date) async throws -> [FlightSegment] {
        let request = try await makeRequest(
            "POST", "travel/search",
            body: FlightSearchRequest(origin: origin, destination: destination, departDate: departDate)
        )
        return try await send(request, as: FlightSearchResponse.self).segments
    }

    /// Mutating, and the one call that can double-charge.
    ///
    /// The idempotency key is generated by the CALLER and held across retries —
    /// generating it here would mint a fresh key per attempt and defeat the
    /// entire mechanism, which is the mistake the Android client documents.
    public func book(offerId: String, idempotencyKey: String) async throws -> TravelBooking {
        let request = try await makeRequest(
            "POST", "travel/book",
            body: BookRequest(offerId: offerId, idempotencyKey: idempotencyKey),
            idempotencyKey: idempotencyKey
        )
        return try await send(request, as: BookResponse.self).booking
    }

    // MARK: - Push

    public func registerDevice(token: String, platform: String = "ios") async throws {
        let request = try await makeRequest(
            "POST", "push/devices",
            body: RegisterDeviceRequest(token: token, platform: platform, client: clientHeader)
        )
        _ = try await send(request, as: EmptyResponse.self)
    }

    public func searchHotels(
        destination: String, checkIn: Date, checkOut: Date
    ) async throws -> [HotelOffer] {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        let request = try await makeRequest(
            "POST", "travel/hotels",
            body: HotelSearchRequest(
                destination: destination,
                checkIn: formatter.string(from: checkIn),
                checkOut: formatter.string(from: checkOut)
            )
        )
        return try await send(request, as: HotelSearchResponse.self).offers
    }

    // MARK: - Rewards, chains, insights, analytics, approvals, collections

    public func fetchRewards() async throws -> RewardsOverview {
        try await send(try await makeRequest("GET", "rewards"), as: RewardsOverview.self)
    }

    /// `chain/status`, not `chains` — the latter has never existed and 404'd.
    public func fetchChains() async throws -> [ChainInfo] {
        try await send(try await makeRequest("GET", "chain/status"), as: ChainsResponse.self).chains
    }

    public func fetchInsights() async throws -> [Insight] {
        try await send(try await makeRequest("GET", "insights"), as: InsightsResponse.self).insights
    }

    public func fetchAnalytics() async throws -> AnalyticsOverview {
        try await send(try await makeRequest("GET", "analytics"), as: AnalyticsOverview.self)
    }

    // MARK: - Pending card approvals (3DS2 out-of-band)
    //
    // These were pointed at `/api/approvals`, which does not exist and never
    // has. Worse than the 404: the shape they expected carried a server-authored
    // `Confirmation` that the app then executed, so the screen's whole design
    // was "let the server name an action and an amount". The real feature is the
    // 3DS2 challenge queue at /api/cards/challenges, which is what the RN app
    // polls — a fixed decision on a fixed transaction, with nothing for a
    // payload to steer.

    public func fetchCardChallenges() async throws -> [CardChallenge] {
        try await send(
            try await makeRequest("GET", "cards/challenges"), as: CardChallengesResponse.self
        ).challenges
    }

    /// Mutating — callers MUST pass a successful `BiometricGate` result.
    public func decideCardChallenge(id: String, approved: Bool) async throws {
        let request = try await makeRequest(
            "POST", "cards/challenges/verify",
            body: ChallengeDecisionRequest(
                challengeId: id, decision: approved ? "approved" : "declined"
            )
        )
        _ = try await send(request, as: EmptyResponse.self)
    }

    /// The collection screen shows tradeable assets, which live on /api/markets
    /// — same source the RN app uses. `/api/collection/{slug}` does not exist.
    public func fetchCollection(slug: String) async throws -> [MarketQuote] {
        try await fetchMarkets(kind: slug.isEmpty ? nil : slug)
    }

    // MARK: - Support

    public func fetchSupportTickets() async throws -> [SupportTicket] {
        let request = try await makeRequest("GET", "support/tickets")
        return try await send(request, as: SupportTicketsResponse.self).tickets
    }

    public func fetchSupportMessages(ticketId: String) async throws -> [SupportMessage] {
        let request = try await makeRequest("GET", "support/tickets/\(Self.segment(ticketId))")
        return try await send(request, as: SupportMessagesResponse.self).messages
    }

    public func replyToSupportTicket(ticketId: String, body: String) async throws {
        let request = try await makeRequest(
            "POST", "support/tickets/\(Self.segment(ticketId))",
            body: SupportReplyRequest(body: body)
        )
        _ = try await send(request, as: EmptyResponse.self)
    }

    // MARK: - Account, security and passkeys

    public func fetchProfile() async throws -> UserProfile {
        let request = try await makeRequest("GET", "profile")
        return try await send(request, as: UserProfile.self)
    }

    /// Whitelisted fields only. Per AGENTS.md rule 4, raw client JSON is never
    /// merged into a stored user object — `security` in particular holds the
    /// TOTP secret and is writable only through the MFA route.
    public func updateProfile(displayName: String?, notifications: NotificationPreferences?) async throws -> UserProfile {
        let request = try await makeRequest(
            "PATCH", "profile",
            body: UpdateProfileRequest(displayName: displayName, notifications: notifications)
        )
        return try await send(request, as: UserProfile.self)
    }

    public func fetchPasskeys() async throws -> [PasskeyCredential] {
        let request = try await makeRequest("GET", "auth/passkey/credentials")
        return try await send(request, as: PasskeysResponse.self).credentials
    }

    public func beginPasskeyRegistration() async throws -> PasskeyRegistrationOptions {
        let request = try await makeRequest("POST", "auth/passkey/register")
        return try await send(request, as: PasskeyRegistrationOptions.self)
    }

    public func completePasskeyRegistration(
        credentialId: String, attestationObject: String,
        clientDataJSON: String, label: String
    ) async throws -> PasskeyCredential {
        let request = try await makeRequest(
            "POST", "auth/passkey/credentials",
            body: CompletePasskeyRegistrationRequest(
                credentialId: credentialId, attestationObject: attestationObject,
                clientDataJSON: clientDataJSON, label: label
            )
        )
        return try await send(request, as: PasskeyCredentialResponse.self).credential
    }

    public func beginPasskeyAuthentication() async throws -> PasskeyRegistrationOptions {
        let request = try await makeRequest("POST", "auth/passkey/authenticate", authenticated: false)
        return try await send(request, as: PasskeyRegistrationOptions.self)
    }

    public func completePasskeyAuthentication(
        credentialId: String, authenticatorData: String, signature: String,
        clientDataJSON: String, userHandle: String
    ) async throws -> String {
        let request = try await makeRequest(
            "POST", "auth/passkey/authenticate",
            body: CompletePasskeyAuthRequest(
                credentialId: credentialId, authenticatorData: authenticatorData,
                signature: signature, clientDataJSON: clientDataJSON, userHandle: userHandle
            ),
            authenticated: false
        )
        return try await send(request, as: TokenResponse.self).token
    }

    public func revokePasskey(id: String) async throws {
        let request = try await makeRequest(
            "DELETE", "auth/passkey/credentials/\(Self.segment(id))"
        )
        _ = try await send(request, as: EmptyResponse.self)
    }

    /// `DELETE /api/account`, the same call the RN client makes.
    ///
    /// There is no `/api/delete-account` route and there never was, so this
    /// previously 404'd — an irreversible action that reported failure while
    /// leaving the account intact, which is at least the safe direction.
    public func deleteAccount() async throws {
        let request = try await makeRequest("DELETE", "account")
        _ = try await send(request, as: EmptyResponse.self)
    }

    // MARK: - Money movement
    //
    // Every mutating call here goes through the registry + biometric gate at
    // the ServiceContainer level. These methods are the transport, not the
    // authorisation — see confirmAndDispatch.

    public func transfer(
        destination: String, amountUsd: Decimal, asset: String, idempotencyKey: String
    ) async throws -> TransferResult {
        let request = try await makeRequest(
            "POST", "wallets/transfer",
            body: TransferRequest(
                destination: destination, amountUsd: amountUsd, asset: asset
            ),
            idempotencyKey: idempotencyKey
        )
        return try await send(request, as: TransferResult.self)
    }

    /// Asks for a quote. The returned `quoteId` is single-use and is the ONLY
    /// thing `executeSwap` acts on — re-quoting at execute time is
    /// unrepresentable by design, so the price the user approved is the price
    /// that executes.
    ///
    /// Both phases POST to `/api/swaps`, which branches on `execute`. The
    /// separate `swaps/quote` path this used to call has never existed, and
    /// `swaps/execute` is a different route with a different schema that
    /// rejects a bare quoteId — between them the entire swap flow was dead.
    public func swapQuote(
        fromToken: String, toToken: String, fromChain: String,
        toChain: String? = nil, amountIn: Decimal
    ) async throws -> SwapQuote {
        let request = try await makeRequest(
            "POST", "swaps",
            body: SwapQuoteRequest(
                fromToken: fromToken, toToken: toToken,
                fromChain: fromChain, toChain: toChain, amountIn: amountIn
            )
        )
        return try await send(request, as: SwapQuote.self)
    }

    public func executeSwap(quoteId: String, idempotencyKey: String) async throws -> SwapExecution {
        let request = try await makeRequest(
            "POST", "swaps",
            body: SwapExecuteRequest(quoteId: quoteId),
            idempotencyKey: idempotencyKey
        )
        return try await send(request, as: SwapExecution.self)
    }

    public func fetchEarn() async throws -> EarnOverview {
        let request = try await makeRequest("GET", "earn")
        return try await send(request, as: EarnOverview.self)
    }

    public func earnDeposit(
        vault: String, amountUsd: Decimal, idempotencyKey: String
    ) async throws {
        let request = try await makeRequest(
            "POST", "earn/deposit",
            body: EarnDepositRequest(vault: vault, amountUsd: amountUsd),
            idempotencyKey: idempotencyKey
        )
        _ = try await send(request, as: EmptyResponse.self)
    }

    public func fetchBills() async throws -> [Bill] {
        let request = try await makeRequest("GET", "bills")
        return try await send(request, as: BillsResponse.self).bills
    }

    public func payBill(id: String, amountUsd: Decimal, idempotencyKey: String) async throws {
        let request = try await makeRequest(
            "POST", "bills",
            body: PayBillRequest(billId: id, amountUsd: amountUsd),
            idempotencyKey: idempotencyKey
        )
        _ = try await send(request, as: EmptyResponse.self)
    }

    public func offRampQuote(amountUsd: Decimal, to currency: String) async throws -> FxQuote {
        let request = try await makeRequest(
            "POST", "offramp",
            body: OffRampRequest(amountUsd: amountUsd, to: currency, execute: false)
        )
        return try await send(request, as: OffRampResponse.self).quote
    }

    public func fetchCredit() async throws -> CreditLine {
        let request = try await makeRequest("GET", "credit")
        return try await send(request, as: CreditLine.self)
    }

    public func fetchBanking() async throws -> BankingOverview {
        let request = try await makeRequest("GET", "banking")
        return try await send(request, as: BankingOverview.self)
    }

    // MARK: - Travel documents (passport vault)
    //
    // Note what is absent: any upload. The document itself goes from the
    // camera to the identity provider over the provider's own TLS session and
    // never passes through this client. See Shared/Models/TravelDocument.swift.

    public func fetchTravelDocuments() async throws -> [TravelDocument] {
        let request = try await makeRequest("GET", "passport")
        return try await send(request, as: DocumentsResponse.self).documents
    }

    public func initDocumentScan(
        issuingCountry: String, documentType: String
    ) async throws -> PassportScanSession {
        let request = try await makeRequest(
            "POST", "passport",
            body: InitScanRequest(issuingCountry: issuingCountry, documentType: documentType)
        )
        return try await send(request, as: PassportScanSession.self)
    }

    /// Reports that the hosted flow finished. The server asks the provider for
    /// the real outcome — this call is not an assertion that it passed.
    public func completeDocumentVerification(sessionId: String) async throws -> TravelDocument {
        let request = try await makeRequest(
            "POST", "passport/verify", body: VerifySessionRequest(sessionId: sessionId)
        )
        return try await send(request, as: DocumentResponse.self).document
    }

    public func fetchDocumentStatus(documentId: String) async throws -> TravelDocument {
        let request = try await makeRequest(
            "GET", "passport/status", query: ["documentId": documentId]
        )
        return try await send(request, as: DocumentResponse.self).document
    }

    public func updateTravelDocument(
        id: String, label: String?, isPrimary: Bool?
    ) async throws -> TravelDocument {
        let request = try await makeRequest(
            "PATCH", "passport/\(Self.segment(id))",
            body: UpdateDocumentRequest(label: label, isPrimary: isPrimary)
        )
        return try await send(request, as: DocumentResponse.self).document
    }

    public func deleteTravelDocument(id: String) async throws {
        // The server requires the literal string as a typed confirmation, the
        // same guard the RN client sends. Destroying a verified document is not
        // something a stray DELETE should accomplish.
        let request = try await makeRequest(
            "DELETE", "passport/\(Self.segment(id))",
            body: DeleteDocumentRequest(confirmation: "DELETE")
        )
        _ = try await send(request, as: EmptyResponse.self)
    }

    // MARK: - Apple Pay

    /// Posts an authorized Apple Pay token for server-side decryption and
    /// capture.
    ///
    /// The token is base64'd opaque ciphertext — the app cannot read it and
    /// must not try. Decryption needs the merchant private key, which lives
    /// with the payment processor and never on a device.
    ///
    /// NOTE: `/api/topup/apple-pay` now EXISTS server-side — Zod-validated
    /// against this exact DTO, rate limited 10/min per user, and deduped on
    /// `Idempotency-Key` so a retried POST cannot capture twice.
    ///
    /// Still `false`, because the route's LIVE path is not wired to a payment
    /// processor: capture needs a Stripe account plus an Apple Pay merchant
    /// certificate (`APPLE_PAY_MERCHANT_ID`), and until both exist the server
    /// returns 502 `processor_not_implemented` rather than crediting against a
    /// capture that never happened. Flipping this now would only trade a clean
    /// "unavailable" for a server error on a payment the user just authorised
    /// with Face ID.
    ///
    /// Flip it once the processor credentials are set in production. The
    /// endpoint, its schema, and the ledger credit are already in place.
    public static let applePayTopUpEnabled = false

    public func submitApplePayTopUp(
        tokenData: Data,
        network: String?,
        displayName: String?,
        amountUsd: Decimal,
        idempotencyKey: String
    ) async throws {
        guard Self.applePayTopUpEnabled else { throw APIError.applePayUnavailable }

        var request = try await makeRequest(
            "POST", "topup/apple-pay",
            body: ApplePayTopUpRequest(
                paymentData: tokenData.base64EncodedString(),
                network: network,
                displayName: displayName,
                amountUsd: amountUsd,
                idempotencyKey: idempotencyKey
            )
        )
        // Sent as a header too: the server should dedupe before it parses a
        // body, and a retried POST must never capture twice.
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        _ = try await send(request, as: EmptyResponse.self)
    }

    // MARK: - Registry-validated action execution

    /// The ONLY way an AI-proposed action reaches the network. The endpoint,
    /// method and body all come from `GuardianActionRegistry`, never from the
    /// model's payload — see ActionRegistry.swift for why.
    ///
    /// `internal`, not `public`: callers go through `GuardianActionDispatcher`,
    /// which will only accept an `ApprovedAction`. Leaving this public would
    /// leave a loose-string door open beside the locked one.
    func executeResolvedAction(
        endpoint: String,
        method: String,
        body: [String: JSONValue]
    ) async throws -> JSONValue {
        let path = endpoint.hasPrefix("/") ? String(endpoint.dropFirst()) : endpoint
        let request = try await makeRequest(method, path, body: body)
        return try await send(request, as: JSONValue.self)
    }
}

// MARK: - Helpers

/// Lets `makeRequest` take an existential `Encodable` without generics leaking
/// into every call site.
private struct AnyEncodable: Encodable {
    private let encodeTo: @Sendable (Encoder) throws -> Void
    /// `some Encodable & Sendable` rather than a bare existential: the closure
    /// below is `@Sendable`, and Swift 6 refuses to let it capture a
    /// non-Sendable `any Encodable`. Constraining here rather than dropping
    /// `@Sendable` keeps the guarantee, and costs nothing — every request body
    /// in this client is one of the project's own DTOs, all of which are
    /// already declared `Encodable, Sendable` (or String).
    init(_ wrapped: some Encodable & Sendable) {
        encodeTo = { encoder in try wrapped.encode(to: encoder) }
    }
    func encode(to encoder: Encoder) throws { try encodeTo(encoder) }
}

public struct EmptyResponse: Decodable, Sendable {
    public init() {}
    public init(from _: Decoder) throws {}
}

extension ISO8601DateFormatter {
    // `nonisolated(unsafe)` because ISO8601DateFormatter is not Sendable, and
    // Swift 6 concurrency checking rejects a shared `static let` of a
    // non-Sendable type outright. The sharing is safe in this specific case:
    // both instances are configured once inside their initialisers and then
    // only ever read from — `formatOptions` is never mutated afterwards, and
    // Foundation's date formatters are documented as safe for concurrent
    // formatting and parsing. Anything that needs to change formatOptions must
    // create its own instance rather than mutate these.
    nonisolated(unsafe) static let standard: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    nonisolated(unsafe) static let withFractionalSeconds: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
