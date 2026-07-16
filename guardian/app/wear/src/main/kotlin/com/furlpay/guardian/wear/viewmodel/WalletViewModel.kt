package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.Wallet
import com.furlpay.guardian.domain.usecase.GetWalletOverviewUseCase
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.sync.WalletSnapshot
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class WalletViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val loading: Boolean = true,
        val totalUsd: Double = 0.0,
        val wallets: List<Wallet> = emptyList(),
        val stale: Boolean = false,
        val error: String? = null,
    )

    private val services = app.wearServices
    private val overview = GetWalletOverviewUseCase(services.walletRepo)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        viewModelScope.launch {
            when (val result = overview()) {
                is GuardianResult.Ok -> _state.value = UiState(
                    loading = false,
                    totalUsd = result.value.totalUsd,
                    wallets = result.value.wallets,
                )

                is GuardianResult.Err -> {
                    val cached = services.snapshots.read(SyncProtocol.DATA_WALLET)?.let {
                        runCatching {
                            SyncProtocol.json.decodeFromString(WalletSnapshot.serializer(), it.json)
                        }.getOrNull()
                    }
                    _state.value = if (cached != null) {
                        UiState(
                            loading = false,
                            totalUsd = cached.totalUsd,
                            wallets = cached.toWallets(),
                            stale = true,
                        )
                    } else {
                        UiState(loading = false, error = result.message)
                    }
                }
            }
        }
    }
}
