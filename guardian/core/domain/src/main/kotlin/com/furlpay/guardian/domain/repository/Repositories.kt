package com.furlpay.guardian.domain.repository

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.model.Portfolio
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.model.SpendingSummary
import com.furlpay.guardian.domain.model.Transaction
import com.furlpay.guardian.domain.model.TravelBooking
import com.furlpay.guardian.domain.model.Wallet

// ---------------------------------------------------------------------------
// Repository contracts. :core:network implements these against furlpay.com/api;
// :core:data decorates them with the Room offline cache the watch reads when
// the phone is unreachable. Use cases and ViewModels only ever see these.
// ---------------------------------------------------------------------------

interface WalletRepository {
    suspend fun wallets(): GuardianResult<List<Wallet>>
}

interface CardRepository {
    suspend fun cards(): GuardianResult<List<Card>>

    /** Freeze/unfreeze — MUTATING: callers must pass a biometric gate first. */
    suspend fun setFrozen(cardId: String, freeze: Boolean): GuardianResult<Card>
}

interface TransactionRepository {
    suspend fun recent(limit: Int = 20): GuardianResult<List<Transaction>>
    suspend fun spendingSummary(period: SpendingPeriod): GuardianResult<SpendingSummary>
}

interface PortfolioRepository {
    suspend fun overview(): GuardianResult<Portfolio>
}

interface TravelRepository {
    suspend fun upcoming(): GuardianResult<List<TravelBooking>>
}

/** Life Guardian events (Gmail/Calendar/GitHub/manual), backed by Room. */
interface EventRepository {
    suspend fun activeEvents(): GuardianResult<List<GuardianEvent>>
    suspend fun upsert(events: List<GuardianEvent>): GuardianResult<Unit>
    suspend fun acknowledge(eventId: String): GuardianResult<Unit>
}
