package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.Position
import com.furlpay.guardian.sync.PortfolioSnapshot
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class PortfolioViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val loading: Boolean = true,
        val totalUsd: Double? = null,
        val dayChangeUsd: Double = 0.0,
        val dayChangePct: Double = 0.0,
        val positions: List<Position> = emptyList(),
        val stale: Boolean = false,
        val error: String? = null,
    )

    private val services = app.wearServices

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        viewModelScope.launch {
            when (val result = services.portfolioRepo.overview()) {
                is GuardianResult.Ok -> {
                    val p = result.value
                    // Refresh the snapshot so the tile/complication agree.
                    services.snapshots.write(
                        SyncProtocol.DATA_PORTFOLIO,
                        SyncProtocol.json.encodeToString(
                            PortfolioSnapshot.serializer(),
                            PortfolioSnapshot.from(p, kotlinx.datetime.Clock.System.now()),
                        ),
                    )
                    _state.value = UiState(
                        loading = false,
                        totalUsd = p.totalUsd,
                        dayChangeUsd = p.dayChangeUsd,
                        dayChangePct = p.dayChangePct,
                        positions = p.positions.sortedByDescending { it.usdValue },
                    )
                }

                is GuardianResult.Err -> {
                    val cached = services.snapshots.read(SyncProtocol.DATA_PORTFOLIO)?.let {
                        runCatching {
                            SyncProtocol.json.decodeFromString(PortfolioSnapshot.serializer(), it.json)
                        }.getOrNull()
                    }
                    _state.value = if (cached != null) {
                        UiState(
                            loading = false,
                            totalUsd = cached.totalUsd,
                            dayChangeUsd = cached.dayChangeUsd,
                            dayChangePct = cached.dayChangePct,
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
