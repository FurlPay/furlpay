package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.usecase.GetWalletOverviewUseCase
import com.furlpay.guardian.domain.usecase.briefLine
import com.furlpay.guardian.sync.PortfolioSnapshot
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.sync.WalletSnapshot
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock

/**
 * Home = the glanceable headline. Network first; on failure fall back to the
 * snapshot cache and SAY SO (`stale = true`) — old money must look old.
 */
class HomeViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val loading: Boolean = true,
        val totalUsd: Double? = null,
        /** Portfolio day change — the brief's second line. */
        val dayChangeUsd: Double? = null,
        val dayChangePct: Double? = null,
        /** Deterministic one-liner (briefLine) — tap opens Ask Guardian. */
        val insight: String? = null,
        val stale: Boolean = false,
        val nextEventTitle: String? = null,
        val nextTripTitle: String? = null,
        val tripDaysLeft: Int? = null,
        val signedOut: Boolean = false,
    )

    private val services = app.wearServices
    private val overview = GetWalletOverviewUseCase(services.walletRepo)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val signedIn = services.tokenStore.token() != null
            if (!signedIn) {
                // Token not synced yet — ask the phone, then render cache.
                _state.value = UiState(loading = false, signedOut = true)
                return@launch
            }

            when (val result = overview()) {
                is GuardianResult.Ok -> {
                    val snapshot = WalletSnapshot.from(result.value, Clock.System.now())
                    services.snapshots.write(
                        SyncProtocol.DATA_WALLET,
                        SyncProtocol.json.encodeToString(WalletSnapshot.serializer(), snapshot),
                    )
                    _state.value = _state.value.copy(
                        loading = false,
                        totalUsd = result.value.totalUsd,
                        stale = false,
                        signedOut = false,
                    )
                }

                is GuardianResult.Err -> {
                    val cached = services.snapshots.read(SyncProtocol.DATA_WALLET)?.let {
                        runCatching {
                            SyncProtocol.json.decodeFromString(WalletSnapshot.serializer(), it.json)
                        }.getOrNull()
                    }
                    _state.value = _state.value.copy(
                        loading = false,
                        totalUsd = cached?.totalUsd,
                        stale = cached != null,
                        signedOut = false,
                    )
                }
            }

            loadSecondaryLines()
        }
    }

    private suspend fun loadSecondaryLines() {
        // Portfolio day change + brief insight; cached day change when offline.
        when (val portfolio = services.portfolioRepo.overview()) {
            is GuardianResult.Ok -> _state.value = _state.value.copy(
                dayChangeUsd = portfolio.value.dayChangeUsd,
                dayChangePct = portfolio.value.dayChangePct,
                insight = portfolio.value.briefLine(),
            )

            is GuardianResult.Err -> services.snapshots.read(SyncProtocol.DATA_PORTFOLIO)
                ?.let {
                    runCatching {
                        SyncProtocol.json.decodeFromString(PortfolioSnapshot.serializer(), it.json)
                    }.getOrNull()
                }
                ?.let { cached ->
                    _state.value = _state.value.copy(
                        dayChangeUsd = cached.dayChangeUsd,
                        dayChangePct = cached.dayChangePct,
                    )
                }
        }

        (services.eventRepo.activeEvents() as? GuardianResult.Ok)?.value
            ?.filter { it.startAt != null && it.startAt!! >= Clock.System.now() }
            ?.minByOrNull { it.startAt!! }
            ?.let { _state.value = _state.value.copy(nextEventTitle = it.title) }

        (services.travelRepo.upcoming() as? GuardianResult.Ok)?.value
            ?.firstOrNull()
            ?.let { trip ->
                val daysLeft = (trip.startAt - Clock.System.now()).inWholeDays.toInt()
                _state.value = _state.value.copy(
                    nextTripTitle = trip.title,
                    tripDaysLeft = daysLeft.takeIf { it >= 0 },
                )
            }
    }
}
