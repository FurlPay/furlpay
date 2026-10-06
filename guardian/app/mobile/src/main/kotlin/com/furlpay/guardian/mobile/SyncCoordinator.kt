package com.furlpay.guardian.mobile

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.usecase.GetWalletOverviewUseCase
import com.furlpay.guardian.sync.EventsSnapshot
import com.furlpay.guardian.sync.MarketSnapshot
import com.furlpay.guardian.sync.PortfolioSnapshot
import com.furlpay.guardian.sync.SpendingSnapshot
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.sync.TripsSnapshot
import com.furlpay.guardian.sync.WalletSnapshot
import kotlinx.datetime.Clock

/**
 * Phone → watch state push. Called after sign-in, from the dashboard's
 * "Sync watch" action, and whenever the watch sends MSG_REFRESH_REQUEST.
 * Each snapshot is best-effort and independent — a travel API hiccup must
 * not stop the balance from reaching the wrist.
 */
class SyncCoordinator(private val services: MobileServices) {

    suspend fun pushAll() {
        pushToken()
        pushWallet()
        pushEvents()
        pushTrips()
        pushPortfolio()
        pushSpending()
        pushMarket()
    }

    /**
     * Give the watch a SCOPED token (SEC-P2-004): read-only plus card freeze,
     * not refreshable, tied to this phone session so sign-out ends it. It used
     * to be the phone's own bearer, the one that moves money. If minting fails
     * nothing is pushed: the watch keeps its synced snapshots, and the phone
     * token is never a fallback.
     */
    suspend fun pushToken() {
        if (services.tokenStore.token() == null) return
        val watchToken = runCatching { services.client.api.watchToken().token }.getOrNull() ?: return
        runCatching { services.dataLayer.putJson(SyncProtocol.DATA_AUTH_TOKEN, watchToken) }
    }

    suspend fun pushWallet() {
        val overview = GetWalletOverviewUseCase(services.walletRepo)()
        if (overview is GuardianResult.Ok) {
            val snapshot = WalletSnapshot.from(overview.value, Clock.System.now())
            runCatching {
                services.dataLayer.putJson(
                    SyncProtocol.DATA_WALLET,
                    SyncProtocol.json.encodeToString(WalletSnapshot.serializer(), snapshot),
                )
            }
        }
    }

    suspend fun pushEvents() {
        val events = services.eventRepo.activeEvents()
        if (events is GuardianResult.Ok) {
            // Arm the escalation ladders alongside the sync — the alarm is a
            // property of the event feed, not a separate subsystem to forget.
            runCatching { services.alarmScheduler.armForEvents(events.value) }
            val snapshot = EventsSnapshot.from(events.value, Clock.System.now())
            runCatching {
                services.dataLayer.putJson(
                    SyncProtocol.DATA_EVENTS,
                    SyncProtocol.json.encodeToString(EventsSnapshot.serializer(), snapshot),
                )
            }
        }
    }

    suspend fun pushTrips() {
        val trips = services.travelRepo.upcoming()
        if (trips is GuardianResult.Ok) {
            val snapshot = TripsSnapshot.from(trips.value, Clock.System.now())
            runCatching {
                services.dataLayer.putJson(
                    SyncProtocol.DATA_TRIPS,
                    SyncProtocol.json.encodeToString(TripsSnapshot.serializer(), snapshot),
                )
            }
        }
    }

    suspend fun pushPortfolio() {
        val portfolio = services.portfolioRepo.overview()
        if (portfolio is GuardianResult.Ok) {
            val snapshot = PortfolioSnapshot.from(portfolio.value, Clock.System.now())
            runCatching {
                services.dataLayer.putJson(
                    SyncProtocol.DATA_PORTFOLIO,
                    SyncProtocol.json.encodeToString(PortfolioSnapshot.serializer(), snapshot),
                )
            }
        }
    }

    suspend fun pushMarket() {
        runCatching {
            val response = services.client.api.markets(kind = "crypto", limit = 3)
            if (response.items.isEmpty()) return
            val snapshot = MarketSnapshot(
                // Only assets with a real quote reach the watch. A glanceable
                // tile showing "—" wastes the one line it has; an unpriced
                // asset is better omitted than displayed as flat 0.00.
                items = response.items
                    .filter { it.price != null && it.changePct != null }
                    .map { MarketSnapshot.MarketItem(it.symbol, it.price!!, it.changePct!!) },
                updatedAtMs = System.currentTimeMillis(),
            )
            services.dataLayer.putJson(
                SyncProtocol.DATA_MARKET,
                SyncProtocol.json.encodeToString(MarketSnapshot.serializer(), snapshot),
            )
        }
    }

    suspend fun pushSpending() {
        val today = services.transactionRepo.spendingSummary(SpendingPeriod.TODAY)
        val week = services.transactionRepo.spendingSummary(SpendingPeriod.THIS_WEEK)
        if (today is GuardianResult.Ok) {
            val snapshot = SpendingSnapshot(
                todayUsd = today.value.totalUsd,
                todayCount = today.value.transactionCount,
                weekUsd = (week as? GuardianResult.Ok)?.value?.totalUsd ?: 0.0,
                updatedAtMs = System.currentTimeMillis(),
            )
            runCatching {
                services.dataLayer.putJson(
                    SyncProtocol.DATA_SPENDING,
                    SyncProtocol.json.encodeToString(SpendingSnapshot.serializer(), snapshot),
                )
            }
        }
    }
}
