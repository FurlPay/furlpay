package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.model.SpendingSummary
import com.furlpay.guardian.sync.SpendingSnapshot
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** "Am I on budget?" — the bible's fourth glanceable question. */
class SpendingViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val loading: Boolean = true,
        val period: SpendingPeriod = SpendingPeriod.TODAY,
        val summary: SpendingSummary? = null,
        val stale: Boolean = false,
        val error: String? = null,
    )

    private val services = app.wearServices

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        load(SpendingPeriod.TODAY)
    }

    fun onPeriodSelected(period: SpendingPeriod) {
        if (period != _state.value.period || _state.value.summary == null) load(period)
    }

    private fun load(period: SpendingPeriod) {
        _state.value = _state.value.copy(loading = true, period = period, error = null)
        viewModelScope.launch {
            when (val result = services.transactionRepo.spendingSummary(period)) {
                is GuardianResult.Ok -> _state.value = _state.value.copy(
                    loading = false,
                    summary = result.value,
                    stale = false,
                )

                is GuardianResult.Err -> {
                    // Snapshot fallback covers today/week only (what the phone pushes).
                    val cached = services.snapshots.read(SyncProtocol.DATA_SPENDING)?.let {
                        runCatching {
                            SyncProtocol.json.decodeFromString(SpendingSnapshot.serializer(), it.json)
                        }.getOrNull()
                    }
                    val fallback = when {
                        cached == null -> null
                        period == SpendingPeriod.TODAY -> SpendingSummary(
                            period, cached.todayUsd, cached.todayCount,
                        )
                        period == SpendingPeriod.THIS_WEEK -> SpendingSummary(
                            period, cached.weekUsd, transactionCount = 0,
                        )
                        else -> null
                    }
                    _state.value = if (fallback != null) {
                        _state.value.copy(loading = false, summary = fallback, stale = true)
                    } else {
                        _state.value.copy(loading = false, error = result.message)
                    }
                }
            }
        }
    }
}
