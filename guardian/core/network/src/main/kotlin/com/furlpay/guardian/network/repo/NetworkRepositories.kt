package com.furlpay.guardian.network.repo

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.model.Portfolio
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.model.SpendingSummary
import com.furlpay.guardian.domain.model.Transaction
import com.furlpay.guardian.domain.model.TravelBooking
import com.furlpay.guardian.domain.model.Wallet
import com.furlpay.guardian.domain.repository.CardRepository
import com.furlpay.guardian.domain.repository.PortfolioRepository
import com.furlpay.guardian.domain.repository.TransactionRepository
import com.furlpay.guardian.domain.repository.TravelRepository
import com.furlpay.guardian.domain.repository.WalletRepository
import com.furlpay.guardian.domain.usecase.ComputeSpendingSummaryUseCase
import com.furlpay.guardian.network.FurlPayApi
import com.furlpay.guardian.network.dto.CardSettingsRequest
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
}
