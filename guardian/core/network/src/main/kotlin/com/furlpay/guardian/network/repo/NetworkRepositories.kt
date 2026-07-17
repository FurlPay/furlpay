package com.furlpay.guardian.network.repo

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.AssetDetail
import com.furlpay.guardian.domain.model.BookingReceipt
import com.furlpay.guardian.domain.model.Candle
import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.model.FlightOffer
import com.furlpay.guardian.domain.model.MarketQuote
import com.furlpay.guardian.domain.model.OrderFill
import com.furlpay.guardian.domain.model.Portfolio
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.model.SpendingSummary
import com.furlpay.guardian.domain.model.StayOption
import com.furlpay.guardian.domain.model.Transaction
import com.furlpay.guardian.domain.model.TravelBooking
import com.furlpay.guardian.domain.model.TravelDeal
import com.furlpay.guardian.domain.model.TripSummary
import com.furlpay.guardian.domain.model.Wallet
import com.furlpay.guardian.domain.repository.CardRepository
import com.furlpay.guardian.domain.repository.PortfolioRepository
import com.furlpay.guardian.domain.repository.TransactionRepository
import com.furlpay.guardian.domain.repository.TravelRepository
import com.furlpay.guardian.domain.repository.WalletRepository
import com.furlpay.guardian.domain.usecase.ComputeSpendingSummaryUseCase
import com.furlpay.guardian.network.FurlPayApi
import com.furlpay.guardian.network.dto.BookRequest
import com.furlpay.guardian.network.dto.CardSettingsRequest
import com.furlpay.guardian.network.dto.FlightSearchRequest
import com.furlpay.guardian.network.dto.OrderRequest
import kotlinx.datetime.Clock
import kotlinx.datetime.TimeZone

// ---------------------------------------------------------------------------
// Domain repositories over the live API. Errors become GuardianResult.Err —
// nothing network-shaped crosses into ViewModels. :core:data later decorates
// these with the Room offline cache the watch falls back to.
// ---------------------------------------------------------------------------

private inline fun <T> guard(block: () -> T): GuardianResult<T> =
    try {
        GuardianResult.Ok(block())
    } catch (e: Exception) {
        GuardianResult.Err(e.message ?: "Network error", e)
    }

class FurlPayWalletRepository(private val api: FurlPayApi) : WalletRepository {
    override suspend fun wallets(): GuardianResult<List<Wallet>> =
        guard { api.wallets().balances.map { it.toDomain() } }
}

class FurlPayCardRepository(private val api: FurlPayApi) : CardRepository {
    override suspend fun cards(): GuardianResult<List<Card>> =
        guard { api.cards().cards.map { it.toDomain() } }

    override suspend fun setFrozen(cardId: String, freeze: Boolean): GuardianResult<Card> =
        when (val result = guard { api.cardSettings(CardSettingsRequest(cardId, freeze)) }) {
            is GuardianResult.Err -> result
            is GuardianResult.Ok ->
                result.value.card?.let { GuardianResult.Ok(it.toDomain()) }
                    ?: GuardianResult.Err("Card update returned no card.")
        }
}

class FurlPayTransactionRepository(
    private val api: FurlPayApi,
    private val computeSummary: ComputeSpendingSummaryUseCase = ComputeSpendingSummaryUseCase(),
    private val clock: Clock = Clock.System,
    private val timeZone: TimeZone = TimeZone.currentSystemDefault(),
) : TransactionRepository {

    override suspend fun recent(limit: Int): GuardianResult<List<Transaction>> =
        guard {
            api.transactions().transactions
                .mapNotNull { it.toDomain() }
                .sortedByDescending { it.at }
                .take(limit)
        }

    override suspend fun spendingSummary(period: SpendingPeriod): GuardianResult<SpendingSummary> =
        // No summary endpoint exists server-side (verified) — pull the ledger
        // and let the tested pure function do the math.
        when (val txs = guard { api.transactions().transactions.mapNotNull { it.toDomain() } }) {
            is GuardianResult.Err -> txs
            is GuardianResult.Ok ->
                GuardianResult.Ok(computeSummary(txs.value, period, clock.now(), timeZone))
        }
}

class FurlPayPortfolioRepository(private val api: FurlPayApi) : PortfolioRepository {
    override suspend fun overview(): GuardianResult<Portfolio> =
        guard { api.portfolio().toDomain() }
}

class FurlPayTravelRepository(private val api: FurlPayApi) : TravelRepository {
    override suspend fun upcoming(): GuardianResult<List<TravelBooking>> =
        guard {
            api.trips().upcoming
                .mapNotNull { it.toDomain() }
                .sortedBy { it.startAt }
        }

    /** Trip rows with amount/method/status — what the watch travel list shows. */
    suspend fun tripSummaries(): GuardianResult<List<TripSummary>> =
        guard {
            val trips = api.trips()
            (trips.upcoming + trips.past.take(3)).map { it.toSummary() }
        }

    suspend fun deals(): GuardianResult<List<TravelDeal>> =
        guard { api.travelDeals().deals.map { it.toDomain() } }

    /** Flights to a city on a date — live Duffel offers when the key is set. */
    suspend fun flights(from: String, to: String, date: String): GuardianResult<List<FlightOffer>> =
        guard {
            api.searchFlights(FlightSearchRequest(from = from, to = to, date = date))
                .results.map { it.toDomain() }
        }

    /** Top-rated bookable stay for a deal's city (native: hotels list, first row). */
    suspend fun topStay(city: String): GuardianResult<StayOption> =
        when (val r = guard { api.travelHotels(city).hotels.orEmpty().map { it.toDomain() } }) {
            is GuardianResult.Err -> r
            is GuardianResult.Ok ->
                r.value.maxByOrNull { it.rating }?.let { GuardianResult.Ok(it) }
                    ?: GuardianResult.Err("No bookable stays in $city right now.")
        }

    /**
     * Book a stay. Server re-derives the price from propertyId + roomIndex +
     * dates and dedupes on [idempotencyKey] — the watch never sends a total.
     */
    suspend fun book(
        stay: StayOption,
        checkIn: String,
        checkOut: String,
        nights: Int,
        idempotencyKey: String,
    ): GuardianResult<BookingReceipt> =
        when (
            val r = guard {
                api.bookStay(
                    BookRequest(
                        name = stay.name,
                        city = stay.city,
                        nights = nights,
                        checkIn = checkIn,
                        checkOut = checkOut,
                        propertyId = stay.id,
                        roomIndex = 0,
                        idempotencyKey = idempotencyKey,
                    ),
                ).booking?.toDomain()
            }
        ) {
            is GuardianResult.Err -> r
            is GuardianResult.Ok ->
                r.value?.let { GuardianResult.Ok(it) }
                    ?: GuardianResult.Err("Booking was not confirmed — check My Trips before retrying.")
        }
}

class FurlPayMarketRepository(private val api: FurlPayApi) {

    /** Top movers first — the same default view as native markets.tsx. */
    suspend fun watchlist(limit: Int = 12): GuardianResult<List<MarketQuote>> =
        guard { api.markets(limit = limit, sort = "-changePct").items.map { it.toDomain() } }

    suspend fun bars(symbol: String, tf: String): GuardianResult<List<Candle>> =
        guard { api.bars(symbol, tf).candles.map { it.toDomain() } }

    suspend fun detail(symbol: String): GuardianResult<AssetDetail> =
        guard { api.asset(symbol).toDomain() }

    /** Fractional notional order. Caller owns the confirm step. */
    suspend fun placeOrder(symbol: String, side: String, notionalUsd: Double): GuardianResult<OrderFill> =
        guard { api.placeOrder(OrderRequest(symbol, side, notionalUsd)).toDomain() }
}
