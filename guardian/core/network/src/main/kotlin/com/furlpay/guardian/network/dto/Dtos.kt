package com.furlpay.guardian.network.dto

import com.furlpay.guardian.domain.model.AssetDetail
import com.furlpay.guardian.domain.model.BoardingPass
import com.furlpay.guardian.domain.model.BoardingPassFlight
import com.furlpay.guardian.domain.model.BoardingPassPassenger
import com.furlpay.guardian.domain.model.BoardingPassPayment
import com.furlpay.guardian.domain.model.BookingReceipt
import com.furlpay.guardian.domain.model.Candle
import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.model.CardLimits
import com.furlpay.guardian.domain.model.FlightOffer
import com.furlpay.guardian.domain.model.FlightStatus
import com.furlpay.guardian.domain.model.MarketQuote
import com.furlpay.guardian.domain.model.OrderFill
import com.furlpay.guardian.domain.model.Portfolio
import com.furlpay.guardian.domain.model.Position
import com.furlpay.guardian.domain.model.StayOption
import com.furlpay.guardian.domain.model.Transaction
import com.furlpay.guardian.domain.model.TransactionDirection
import com.furlpay.guardian.domain.model.TravelBooking
import com.furlpay.guardian.domain.model.TravelDeal
import com.furlpay.guardian.domain.model.TravelKind
import com.furlpay.guardian.domain.model.TripSummary
import com.furlpay.guardian.domain.model.Wallet
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.serialization.Serializable

// ---------------------------------------------------------------------------
// Wire DTOs — shapes VERIFIED against apps/web/src/app/api/* route handlers
// (July 2026), not against the plan doc. Defaults keep a lenient parse: the
// watch should degrade, not crash, when the server adds fields.
// ---------------------------------------------------------------------------

// GET /api/wallets — { safeAddress, modules[], balances[] }
@Serializable
data class WalletsResponse(
    /** The user's Safe smart-account address — what the QuickPay QR encodes. */
    val safeAddress: String? = null,
    val balances: List<BalanceDto> = emptyList(),
)

@Serializable
data class BalanceDto(
    val token: String,
    /** The server serializes amounts as strings ("1234.56"). */
    val amount: String = "0",
    val chain: String? = null,
    val usdValue: Double = 0.0,
) {
    fun toDomain() = Wallet(
        id = if (chain != null) "$token:$chain" else token,
        currency = token,
        balance = amount.toDoubleOrNull() ?: 0.0,
        usdValue = usdValue,
        chain = chain,
    )
}

// GET /api/cards — { cards: PaymentCard[] } (lib/types.ts)
@Serializable
data class CardsResponse(val cards: List<CardDto> = emptyList())

@Serializable
data class CardLimitsDto(
    val perPurchase: Double = 0.0,
    val daily: Double = 0.0,
    val dailySpent: Double = 0.0,
)

@Serializable
data class CardDto(
    val id: String,
    val kind: String = "virtual",
    val label: String? = null,
    val last4: String = "",
    val network: String? = null,
    val frozen: Boolean = false,
    val limits: CardLimitsDto? = null,
) {
    fun toDomain() = Card(
        id = id,
        last4 = last4,
        kind = kind,
        network = network,
        frozen = frozen,
        label = label,
        limits = limits?.let { CardLimits(it.perPurchase, it.daily, it.dailySpent) },
    )
}

// POST /api/cards/settings — freeze subset only; other settings stay phone-side.
@Serializable
data class CardSettingsRequest(val cardId: String, val freeze: Boolean)

@Serializable
data class CardSettingsResponse(val success: Boolean = false, val card: CardDto? = null)

// GET /api/transactions — { transactions: Transaction[] } (lib/types.ts)
@Serializable
data class TransactionsResponse(val transactions: List<TransactionDto> = emptyList())

@Serializable
data class TransactionDto(
    val id: String,
    val category: String? = null,
    /** "in" | "out" */
    val direction: String = "out",
    val title: String = "",
    val subtitle: String? = null,
    val amountUsd: Double = 0.0,
    /** ISO timestamp. */
    val timestamp: String = "",
    /** "settled" | "pending" | "escrow" | "declined" */
    val status: String = "settled",
) {
    fun toDomain(): Transaction? {
        val at = parseFlexibleInstant(timestamp) ?: return null
        return Transaction(
            id = id,
            at = at,
            description = title,
            amountUsd = amountUsd,
            direction = if (direction == "in") TransactionDirection.IN else TransactionDirection.OUT,
            status = status,
            category = category,
        )
    }
}

// GET /api/investing/portfolio — { holdings[], dividends[], performance{} }
@Serializable
data class PortfolioResponse(
    val holdings: List<HoldingDto> = emptyList(),
    val performance: PerformanceDto = PerformanceDto(),
) {
    fun toDomain() = Portfolio(
        totalUsd = performance.marketValue,
        dayChangeUsd = performance.dayChange,
        dayChangePct = performance.dayChangePct,
        positions = holdings.map { it.toDomain() },
    )
}

@Serializable
data class HoldingDto(
    val symbol: String,
    val shares: Double = 0.0,
    val price: Double = 0.0,
    val changePct: Double = 0.0,
    val marketValue: Double? = null,
) {
    fun toDomain() = Position(
        symbol = symbol,
        quantity = shares,
        usdValue = marketValue ?: (shares * price),
        dayChangePct = changePct,
    )
}

@Serializable
data class PerformanceDto(
    val marketValue: Double = 0.0,
    val dayChange: Double = 0.0,
    val dayChangePct: Double = 0.0,
)

// GET /api/travel/trips — { upcoming[], past[], cancelled[] } (lib/travel/store.ts)
@Serializable
data class TripsResponse(
    val upcoming: List<TripDto> = emptyList(),
    val past: List<TripDto> = emptyList(),
    val cancelled: List<TripDto> = emptyList(),
)

@Serializable
data class TripDto(
    val id: String,
    val name: String = "",
    val city: String = "",
    val checkIn: String = "",
    val checkOut: String = "",
    val nights: Int = 0,
    val amountUsd: Double = 0.0,
    val method: String = "",
    val status: String? = null,
) {
    fun toSummary() = TripSummary(
        id = id,
        name = name.ifBlank { city },
        city = city,
        checkIn = checkIn,
        checkOut = checkOut,
        nights = nights,
        amountUsd = amountUsd,
        method = method,
        status = status ?: "confirmed",
    )

    fun toDomain(): TravelBooking? {
        val start = parseFlexibleInstant(checkIn) ?: return null
        return TravelBooking(
            id = id,
            kind = TravelKind.HOTEL, // trips store is stays; flights come later
            title = name.ifBlank { city },
            startAt = start,
            endAt = parseFlexibleInstant(checkOut),
            reference = id,
            detail = listOf(city, "$nights night${if (nights == 1) "" else "s"}")
                .filter { it.isNotBlank() }
                .joinToString(" · "),
        )
    }
}

// GET /api/markets?kind=&sort=&limit= — { items[], asOf }
@Serializable
data class MarketsResponse(val items: List<MarketItemDto> = emptyList())

@Serializable
data class MarketItemDto(
    val symbol: String,
    val name: String = "",
    val kind: String = "stock",
    /**
     * NULLABLE — and the default alone is NOT enough protection.
     *
     * A default value only applies when the key is ABSENT; kotlinx.serialization
     * throws "Unexpected null value" for a non-nullable Double when the JSON
     * carries an explicit `null`. /api/markets/search spans the full ~13k
     * tradable universe and returns uncurated assets unpriced, so a non-null
     * Double here would fail the WHOLE response — the watch would show nothing
     * rather than one dash.
     */
    val price: Double? = null,
    val changePct: Double? = null,
    val live: Boolean = false,
    /** "live" | "delayed" | "unavailable" — switch on this instead of
     *  inferring meaning from a null price. */
    val quoteStatus: String? = null,
    /** Self-hosted mark, e.g. "/logos/stocks/aapl.svg" — null = monogram only. */
    val logo: String? = null,
) {
    fun toDomain() = MarketQuote(
        symbol = symbol,
        name = name,
        kind = kind,
        price = price,
        changePct = changePct,
        live = live,
        quoteStatus = quoteStatus ?: if (price == null) "unavailable" else if (live) "live" else "delayed",
        logoPath = logo,
    )
}

// GET /api/markets/bars?symbol=&tf= — { candles[] } (native PriceChart contract)
@Serializable
data class BarsResponse(val candles: List<CandleDto> = emptyList())

@Serializable
data class CandleDto(
    val time: Long = 0,
    val open: Double = 0.0,
    val high: Double = 0.0,
    val low: Double = 0.0,
    val close: Double = 0.0,
) {
    fun toDomain() = Candle(time, open, high, low, close)
}

// GET /api/markets/{symbol} — { asset{}, quote{}, position? } (subset we render)
@Serializable
data class AssetDetailResponse(
    val asset: AssetDto,
    val quote: QuoteDto = QuoteDto(),
    val position: AssetPositionDto? = null,
) {
    fun toDomain() = AssetDetail(
        quote = MarketQuote(
            symbol = asset.symbol,
            name = asset.name,
            kind = asset.kind,
            price = quote.price,
            changePct = quote.changePct,
            live = quote.live,
            logoPath = asset.logo,
        ),
        positionShares = position?.shares,
        positionValueUsd = position?.marketValue,
    )
}

@Serializable
data class AssetDto(
    val symbol: String,
    val name: String = "",
    val kind: String = "stock",
    val logo: String? = null,
)

@Serializable
data class QuoteDto(
    val price: Double = 0.0,
    val changePct: Double = 0.0,
    val live: Boolean = false,
)

@Serializable
data class AssetPositionDto(
    val shares: Double = 0.0,
    val marketValue: Double = 0.0,
)

// POST /api/investing/order — fractional notional order (native placeOrder)
@Serializable
data class OrderRequest(
    val symbol: String,
    /** "buy" | "sell" */
    val side: String,
    val notional: Double,
)

@Serializable
data class OrderResponse(
    val orderId: String = "",
    val status: String = "",
    val filledQty: Double = 0.0,
) {
    fun toDomain() = OrderFill(orderId, status, filledQty)
}

// GET /api/travel/deals — { deals[] } (native lib/travel.ts Deal)
@Serializable
data class DealsResponse(val deals: List<DealDto> = emptyList())

@Serializable
data class DealDto(
    val id: String,
    val city: String = "",
    val country: String = "",
    val name: String = "",
    val stars: Int = 0,
    val nightlyUsd: Double = 0.0,
    val discountPct: Int = 0,
    val payToken: String = "USDC",
) {
    fun toDomain() = TravelDeal(
        id = id,
        name = name,
        city = city,
        country = country,
        stars = stars,
        nightlyUsd = nightlyUsd,
        discountPct = discountPct,
        payToken = payToken,
    )
}

// POST /api/travel/search {type:"flights",from,to,date,cabin} — { results[] }
@Serializable
data class FlightSearchRequest(
    val type: String = "flights",
    val from: String,
    val to: String,
    val date: String,
    val cabin: String = "Economy",
)

@Serializable
data class FlightSearchResponse(val results: List<FlightDto> = emptyList())

@Serializable
data class FlightDto(
    val id: String,
    val carrier: String = "",
    val carrierCode: String = "",
    val from: String = "",
    val to: String = "",
    val date: String = "",
    val departTime: String = "",
    val arriveTime: String = "",
    val durationMin: Int = 0,
    val stops: Int = 0,
    val cabin: String = "Economy",
    val priceUsd: Double = 0.0,
    val logoUrl: String? = null,
) {
    fun toDomain() = FlightOffer(
        id = id,
        carrier = carrier,
        carrierCode = carrierCode,
        from = from,
        to = to,
        date = date,
        departTime = departTime,
        arriveTime = arriveTime,
        durationMin = durationMin,
        stops = stops,
        cabin = cabin,
        priceUsd = priceUsd,
        logoUrl = logoUrl,
    )
}

// GET /api/travel/hotels?city= — { hotels[] } (top stays for a deal's city)
@Serializable
data class HotelsSearchResponse(val hotels: List<StayDto>? = null, val count: Int = 0)

@Serializable
data class StayDto(
    val id: String,
    val name: String = "",
    val city: String = "",
    val stars: Int = 0,
    val rating: Double = 0.0,
    val nightlyUsd: Double = 0.0,
) {
    fun toDomain() = StayOption(
        id = id,
        name = name,
        city = city,
        stars = stars,
        rating = rating,
        nightlyUsd = nightlyUsd,
    )
}

// POST /api/travel/book — server-authoritative pricing; watch sends identifiers
// + idempotencyKey only (mirrors native BookInput; parity with checkout.tsx).
@Serializable
data class BookRequest(
    val source: String = "travala",
    val name: String,
    val city: String,
    val nights: Int,
    val guests: Int = 1,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val method: String = "USDC",
    val propertyId: String? = null,
    val roomIndex: Int? = null,
    val idempotencyKey: String,
)

@Serializable
data class BookResponse(val booking: BookingDto? = null)

@Serializable
data class BookingDto(
    val id: String = "",
    val reference: String = "",
    val status: String = "",
    val amountUsd: Double = 0.0,
) {
    fun toDomain() = BookingReceipt(id, reference, status, amountUsd)
}

// POST /api/auth/refresh — token present only for X-Furlpay-Client: mobile-*.
@Serializable
data class RefreshResponse(val refreshed: Boolean = false, val token: String? = null)

// POST /api/auth/otp/start + /check — email/phone OTP sign-in. The check
// response carries the session token only for mobile-* clients (Bearer flow).
@Serializable
data class OtpStartRequest(val to: String, val channel: String = "email")

@Serializable
data class OtpCheckRequest(
    val to: String,
    val code: String,
    val channel: String = "email",
    val login: Boolean = true,
)

@Serializable
data class OtpCheckResponse(val verified: Boolean = false, val token: String? = null)

// POST /api/auth/watch-token: the watch's scoped credential (read-only plus
// card freeze), minted from the phone session. Never the phone's own token.
@Serializable
data class WatchTokenResponse(val token: String)

// GET /api/profile — only the fields this app needs. The route returns more,
// and every extra field decoded here is one more thing to keep in sync with a
// response the watch never reads.
@Serializable
data class ProfileResponse(val email: String? = null, val name: String? = null)

// GET /api/account — what deletion would erase and what it cannot.
//
// `retained` comes from the SERVER (lib/accountDeletion.ts RETENTION_NOTICE),
// never from a copy written into the app. A client-side list would drift from
// what the API actually keeps, and the difference between the two is a promise
// the product did not keep.
@Serializable
data class AccountDeletionPreview(
    val stepUpSatisfied: Boolean = false,
    val retained: List<RetainedRecord> = emptyList(),
)

@Serializable
data class RetainedRecord(val record: String = "", val reason: String = "")

// DELETE /api/account
@Serializable
data class AccountDeletionResult(
    val deleted: Boolean = false,
    val erased: List<String> = emptyList(),
    val retained: List<String> = emptyList(),
)

// POST /api/push/devices
@Serializable
data class RegisterDeviceRequest(val token: String, val device: String)

@Serializable
data class RegisterDeviceResponse(
    val registered: Boolean = false,
    val devices: Int = 0,
    /** False = token stored but server FCM creds missing (undeliverable). */
    val deliveryConfigured: Boolean = false,
)

/** "2026-07-20T10:00:00Z" or date-only "2026-07-20" (midnight UTC). */
internal fun parseFlexibleInstant(value: String): Instant? {
    if (value.isBlank()) return null
    return try {
        Instant.parse(value)
    } catch (_: Exception) {
        try {
            LocalDate.parse(value).atStartOfDayIn(TimeZone.UTC)
        } catch (_: Exception) {
            null
        }
    }
}

// ---------------------------------------------------------------------------
// GET /api/travel/boarding-passes — { count, passes[] }
//
// Shape verified against apps/web/src/app/api/travel/boarding-passes/route.ts.
// The route strips `userId` and appends the two clock-derived fields, so what
// arrives is the stored pass minus ownership plus minutesToBoarding/progress.
//
// The same payload feeds web, the Expo app and SwiftUI. Every field the pass
// PRINTS is required — a gate document with a defaulted seat or gate is worse
// than no document, because it looks authoritative. Only the derived numbers
// and `verified` carry defaults, and toDomain() drops any row whose instants
// do not parse rather than rendering a pass with a fabricated timeline.
// ---------------------------------------------------------------------------

@Serializable
data class BoardingPassesResponse(
    val count: Int = 0,
    val passes: List<BoardingPassDto> = emptyList(),
)

@Serializable
data class BoardingPassFlightDto(
    val number: String,
    val aircraft: String,
    val originCode: String,
    val originCity: String,
    val destinationCode: String,
    val destinationCity: String,
    val gate: String,
    val seat: String,
    val boardingTime: String,
    val departureTime: String,
    val arrivalTime: String,
) {
    fun toDomain() = BoardingPassFlight(
        number = number,
        aircraft = aircraft,
        originCode = originCode,
        originCity = originCity,
        destinationCode = destinationCode,
        destinationCity = destinationCity,
        gate = gate,
        seat = seat,
        boardingTime = boardingTime,
        departureTime = departureTime,
        arrivalTime = arrivalTime,
    )
}

@Serializable
data class BoardingPassPassengerDto(
    val name: String,
    val verified: Boolean = false,
) {
    fun toDomain() = BoardingPassPassenger(name = name, verified = verified)
}

@Serializable
data class BoardingPassPaymentDto(
    val currency: String = "USDC",
    val amount: Double = 0.0,
    val rewardsRate: Double = 0.0,
) {
    fun toDomain() = BoardingPassPayment(
        currency = currency,
        amount = amount,
        rewardsRate = rewardsRate,
    )
}

@Serializable
data class BoardingPassDto(
    val id: String,
    val title: String = "",
    val routeLabel: String = "",
    val flight: BoardingPassFlightDto,
    val passenger: BoardingPassPassengerDto,
    val payment: BoardingPassPaymentDto = BoardingPassPaymentDto(),
    val boardingAt: String,
    val departsAt: String,
    val arrivesAt: String,
    val status: String? = null,
    val minutesToBoarding: Int? = null,
    val progress: Double = 0.0,
) {
    /**
     * Null when the timeline is unusable. Every countdown, the status ladder
     * and the route progress are derived from these three instants, so a pass
     * that cannot supply them cannot be rendered honestly — dropping the row
     * is the only non-fabricating option.
     */
    fun toDomain(): BoardingPass? {
        val boarding = parseFlexibleInstant(boardingAt) ?: return null
        val departs = parseFlexibleInstant(departsAt) ?: return null
        val arrives = parseFlexibleInstant(arrivesAt) ?: return null
        return BoardingPass(
            id = id,
            title = title,
            routeLabel = routeLabel,
            flight = flight.toDomain(),
            passenger = passenger.toDomain(),
            payment = payment.toDomain(),
            boardingAt = boarding,
            departsAt = departs,
            arrivesAt = arrives,
            status = FlightStatus.fromWire(status),
            minutesToBoarding = minutesToBoarding,
            progress = progress.coerceIn(0.0, 1.0),
        )
    }
}
