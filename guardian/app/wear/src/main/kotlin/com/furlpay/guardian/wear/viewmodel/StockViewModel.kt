package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.AssetDetail
import com.furlpay.guardian.domain.model.Candle
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * One asset: live quote + bars for the selected timeframe + the order flow.
 * Timeframes are the native PriceChart contract (1D…ALL). The quote
 * re-polls every 15s on 1D so the header price is genuinely live.
 *
 * Ordering is two-step BY DESIGN: pick side+amount, then a separate explicit
 * confirm tap (the watch analogue of the phone's biometric confirm — same
 * pattern as card freeze). Amounts are fixed presets, capped at $250.
 */
class StockViewModel(app: Application) : AndroidViewModel(app) {

    companion object {
        val TIMEFRAMES = listOf("1D", "1W", "1M", "3M", "1Y", "ALL")
        val AMOUNTS = listOf(25.0, 50.0, 100.0, 250.0)
    }

    sealed interface OrderFlow {
        data object Idle : OrderFlow
        data class PickAmount(val side: String) : OrderFlow
        data class Confirm(val side: String, val notionalUsd: Double) : OrderFlow
        data object Placing : OrderFlow
        data class Placed(val message: String) : OrderFlow
        data class Failed(val message: String) : OrderFlow
    }

    data class UiState(
        val symbol: String = "",
        val loading: Boolean = true,
        val detail: AssetDetail? = null,
        val candles: List<Candle> = emptyList(),
        val timeframe: String = "1D",
        val chartLoading: Boolean = false,
        val order: OrderFlow = OrderFlow.Idle,
        val error: String? = null,
    )

    private val repo = getApplication<Application>().wearServices.marketRepo

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    private var quoteJob: Job? = null
    private var barsJob: Job? = null

    fun start(symbol: String) {
        if (_state.value.symbol == symbol) return
        _state.value = UiState(symbol = symbol)
        quoteJob?.cancel()
        quoteJob = viewModelScope.launch {
            while (true) {
                when (val r = repo.detail(symbol)) {
                    is GuardianResult.Ok ->
                        _state.value = _state.value.copy(loading = false, detail = r.value, error = null)
                    is GuardianResult.Err ->
                        if (_state.value.detail == null) {
                            _state.value = _state.value.copy(loading = false, error = r.message)
                        }
                }
                // Live header on the day view; slower elsewhere.
                delay(if (_state.value.timeframe == "1D") 15_000 else 60_000)
            }
        }
        loadBars(symbol, _state.value.timeframe)
    }

    fun setTimeframe(tf: String) {
        if (tf == _state.value.timeframe) return
        _state.value = _state.value.copy(timeframe = tf)
        loadBars(_state.value.symbol, tf)
    }

    private fun loadBars(symbol: String, tf: String) {
        barsJob?.cancel()
        barsJob = viewModelScope.launch {
            _state.value = _state.value.copy(chartLoading = true)
            when (val r = repo.bars(symbol, tf)) {
                is GuardianResult.Ok ->
                    _state.value = _state.value.copy(candles = r.value, chartLoading = false)
                is GuardianResult.Err ->
                    _state.value = _state.value.copy(candles = emptyList(), chartLoading = false)
            }
        }
    }

    // --- order flow -------------------------------------------------------

    fun beginOrder(side: String) {
        _state.value = _state.value.copy(order = OrderFlow.PickAmount(side))
    }

    fun pickAmount(notionalUsd: Double) {
        val side = (state.value.order as? OrderFlow.PickAmount)?.side ?: return
        _state.value = _state.value.copy(order = OrderFlow.Confirm(side, notionalUsd))
    }

    fun confirmOrder() {
        val confirm = state.value.order as? OrderFlow.Confirm ?: return
        _state.value = _state.value.copy(order = OrderFlow.Placing)
        viewModelScope.launch {
            when (val r = repo.placeOrder(state.value.symbol, confirm.side, confirm.notionalUsd)) {
                is GuardianResult.Ok -> _state.value = _state.value.copy(
                    order = OrderFlow.Placed(
                        (if (r.value.status == "filled") "Filled" else "Placed") +
                            " — %.4f shares".format(r.value.filledQty),
                    ),
                )
                is GuardianResult.Err ->
                    _state.value = _state.value.copy(order = OrderFlow.Failed(r.message))
            }
        }
    }

    fun dismissOrder() {
        _state.value = _state.value.copy(order = OrderFlow.Idle)
    }
}
