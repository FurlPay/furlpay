package com.furlpay.guardian.mobile.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.Card
import com.furlpay.guardian.domain.model.TravelBooking
import com.furlpay.guardian.domain.model.Wallet
import com.furlpay.guardian.domain.usecase.GetWalletOverviewUseCase
import com.furlpay.guardian.mobile.mobileServices
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class DashboardViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val totalUsd: Double? = null,
        val wallets: List<Wallet> = emptyList(),
        val cards: List<Card> = emptyList(),
        val trips: List<TravelBooking> = emptyList(),
        val syncing: Boolean = false,
        val syncMessage: String? = null,
        val error: String? = null,
    )

    private val services = app.mobileServices
    private val overview = GetWalletOverviewUseCase(services.walletRepo)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = overview()) {
                is GuardianResult.Ok -> _state.value = _state.value.copy(
                    totalUsd = result.value.totalUsd,
                    wallets = result.value.wallets,
                    error = null,
                )
                is GuardianResult.Err -> _state.value = _state.value.copy(error = result.message)
            }
            (services.cardRepo.cards() as? GuardianResult.Ok)?.let {
                _state.value = _state.value.copy(cards = it.value)
            }
            (services.travelRepo.upcoming() as? GuardianResult.Ok)?.let {
                _state.value = _state.value.copy(trips = it.value)
            }
        }
    }

    fun syncWatch() {
        _state.value = _state.value.copy(syncing = true, syncMessage = null)
        viewModelScope.launch {
            services.sync.pushAll()
            _state.value = _state.value.copy(
                syncing = false,
                syncMessage = "Watch updated (token, wallet, events, trips).",
            )
        }
    }

    fun signOut() {
        viewModelScope.launch {
            services.authManager.signOut()
            // Wipe the watch's copy too — an empty token clears its store.
            runCatching {
                services.dataLayer.putJson(
                    com.furlpay.guardian.sync.SyncProtocol.DATA_AUTH_TOKEN,
                    "",
                )
            }
        }
    }
}
