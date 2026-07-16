package com.furlpay.guardian.mobile

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.usecase.GetWalletOverviewUseCase
import com.furlpay.guardian.sync.EventsSnapshot
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
    }

    suspend fun pushToken() {
        val token = services.tokenStore.token() ?: return
        runCatching { services.dataLayer.putJson(SyncProtocol.DATA_AUTH_TOKEN, token) }
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
}
