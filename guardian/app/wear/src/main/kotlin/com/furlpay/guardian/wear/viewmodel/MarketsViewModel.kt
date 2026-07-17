package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.MarketQuote
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Live watchlist — /api/markets top movers, refreshed every 30s while the
 * screen is open (the endpoint is quote data, not user data, so it renders
 * even before the phone has synced a session).
 */
class MarketsViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val loading: Boolean = true,
        val quotes: List<MarketQuote> = emptyList(),
        /** symbol → 1D closes, filled lazily. REAL bars only — no fake lines. */
        val sparks: Map<String, List<Double>> = emptyMap(),
        val error: String? = null,
    )

    private val repo = app.wearServices.marketRepo

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        viewModelScope.launch {
            while (true) {
                when (val r = repo.watchlist(limit = 14)) {
                    is GuardianResult.Ok -> {
                        _state.value = _state.value.copy(loading = false, quotes = r.value, error = null)
                        fillSparklines(r.value.map { it.symbol })
                    }
                    is GuardianResult.Err ->
                        // Keep showing the last good list; only surface the
                        // error when we never had data.
                        if (_state.value.quotes.isEmpty()) {
                            _state.value = UiState(loading = false, error = r.message)
                        }
                }
                delay(30_000)
            }
        }
    }

    private suspend fun fillSparklines(symbols: List<String>) {
        for (symbol in symbols) {
            if (_state.value.sparks.containsKey(symbol)) continue
            when (val bars = repo.bars(symbol, "1D")) {
                is GuardianResult.Ok ->
                    _state.value = _state.value.copy(
                        sparks = _state.value.sparks + (symbol to bars.value.map { it.close }),
                    )
                is GuardianResult.Err -> Unit // row simply has no sparkline
            }
        }
    }
}
