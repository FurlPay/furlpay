package com.furlpay.guardian.mobile.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.BoardingPass
import com.furlpay.guardian.domain.model.statusAt
import com.furlpay.guardian.mobile.mobileServices
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.Instant

/**
 * Trips state: the caller's boarding passes off GET /api/travel/boarding-passes.
 *
 * There is NO local fallback pass and no seeded itinerary. With nothing booked
 * the screen says so — a placeholder gate document is worse than an empty
 * screen, because it looks authoritative at exactly the moment someone is
 * trying to board.
 */
class TripsViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val passes: List<BoardingPass> = emptyList(),
        /** True only for the FIRST load, so a pull-to-refresh does not blank
         *  a pass the passenger is currently reading at the gate. */
        val loading: Boolean = true,
        val refreshing: Boolean = false,
        val error: String? = null,
    ) {
        /**
         * The pass to show. Landed flights are already filtered server-side;
         * this re-checks against the local clock so a screen left open
         * overnight does not keep presenting a document for a finished flight.
         */
        fun activePass(now: Instant): BoardingPass? =
            passes.firstOrNull { it.statusAt(now) != com.furlpay.guardian.domain.model.FlightStatus.LANDED }
    }

    private val services = app.mobileServices

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    // NOTE: the once-a-second clock that drives the countdown lives in the
    // composable, not here. `viewModel()` scopes this to the Activity, so a
    // ticker started in init would keep running after the passenger closes
    // Trips and for as long as the app is alive.

    init {
        refresh()
    }

    fun refresh() {
        val firstLoad = _state.value.passes.isEmpty()
        _state.value = _state.value.copy(
            loading = firstLoad,
            refreshing = !firstLoad,
            error = null,
        )
        viewModelScope.launch {
            when (val result = services.travelRepo.boardingPasses()) {
                is GuardianResult.Ok -> _state.value = UiState(
                    passes = result.value,
                    loading = false,
                    refreshing = false,
                    error = null,
                )
                is GuardianResult.Err -> _state.value = _state.value.copy(
                    loading = false,
                    refreshing = false,
                    // Surfaced verbatim. "Something went wrong" on a boarding
                    // screen tells a passenger nothing about whether to walk to
                    // the gate or find a desk.
                    error = result.message,
                )
            }
        }
    }
}
