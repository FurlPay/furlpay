package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.FlightOffer
import com.furlpay.guardian.domain.model.StayOption
import com.furlpay.guardian.domain.model.TravelDeal
import com.furlpay.guardian.domain.model.TripSummary
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Travel on the wrist: your trips (with amount/method/status), live flight
 * offers, and flash deals that can be BOOKED AND PAID from the watch.
 *
 * Booking flow mirrors the phone checkout security model exactly:
 * identifiers only (propertyId/roomIndex/dates) + an idempotencyKey minted
 * ONCE per attempt — the server owns the price and dedupes retries. The
 * confirm step shows the server-quoted nightly rate and the explicit
 * "hold to confirm"-style second tap before any money moves.
 */
class TravelViewModel(app: Application) : AndroidViewModel(app) {

    sealed interface BookFlow {
        data object Idle : BookFlow
        data object Resolving : BookFlow
        data class Confirm(
            val deal: TravelDeal,
            val stay: StayOption,
            val checkIn: String,
            val checkOut: String,
            val nights: Int,
            val idempotencyKey: String,
        ) : BookFlow
        data object Booking : BookFlow
        data class Booked(val reference: String, val amountUsd: Double) : BookFlow
        data class Failed(val message: String) : BookFlow
    }

    data class UiState(
        val loading: Boolean = true,
        val trips: List<TripSummary> = emptyList(),
        val deals: List<TravelDeal> = emptyList(),
        val flights: List<FlightOffer> = emptyList(),
        val flightsRoute: String? = null,
        val book: BookFlow = BookFlow.Idle,
        val error: String? = null,
    )

    private val repo = app.wearServices.travelRepo

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val tripsDeferred = async { repo.tripSummaries() }
            val dealsDeferred = async { repo.deals() }
            val trips = tripsDeferred.await()
            val deals = dealsDeferred.await()
            _state.value = _state.value.copy(
                loading = false,
                trips = (trips as? GuardianResult.Ok)?.value ?: _state.value.trips,
                deals = (deals as? GuardianResult.Ok)?.value ?: _state.value.deals,
                error = when {
                    trips is GuardianResult.Ok || deals is GuardianResult.Ok -> null
                    trips is GuardianResult.Err -> trips.message
                    else -> null
                },
            )
            // Flight data: live offers to the top deal's city, dated its
            // check-in window (next week) — the watch's glanceable answer to
            // "how do I get there".
            (deals as? GuardianResult.Ok)?.value?.firstOrNull()?.let { deal ->
                loadFlights(to = deal.city)
            }
        }
    }

    private suspend fun loadFlights(to: String) {
        val date = java.time.LocalDate.now().plusDays(7).toString()
        when (val r = repo.flights(from = "New York", to = to, date = date)) {
            is GuardianResult.Ok ->
                _state.value = _state.value.copy(
                    flights = r.value.sortedBy { it.priceUsd }.take(4),
                    flightsRoute = "NYC to $to",
                )
            is GuardianResult.Err -> Unit // section simply doesn't render
        }
    }

    // --- book & pay -------------------------------------------------------

    /** Resolve the deal's city to its top bookable stay, then ask to confirm. */
    fun beginBooking(deal: TravelDeal) {
        _state.value = _state.value.copy(book = BookFlow.Resolving)
        viewModelScope.launch {
            when (val stay = repo.topStay(deal.city)) {
                is GuardianResult.Ok -> {
                    val checkIn = java.time.LocalDate.now().plusDays(7)
                    val nights = 2
                    _state.value = _state.value.copy(
                        book = BookFlow.Confirm(
                            deal = deal,
                            stay = stay.value,
                            checkIn = checkIn.toString(),
                            checkOut = checkIn.plusDays(nights.toLong()).toString(),
                            nights = nights,
                            // Minted once per attempt — retries reuse it, so the
                            // server books at most one stay (native parity).
                            idempotencyKey = UUID.randomUUID().toString(),
                        ),
                    )
                }
                is GuardianResult.Err ->
                    _state.value = _state.value.copy(book = BookFlow.Failed(stay.message))
            }
        }
    }

    fun confirmBooking() {
        val confirm = _state.value.book as? BookFlow.Confirm ?: return
        _state.value = _state.value.copy(book = BookFlow.Booking)
        viewModelScope.launch {
            when (
                val r = repo.book(
                    stay = confirm.stay,
                    checkIn = confirm.checkIn,
                    checkOut = confirm.checkOut,
                    nights = confirm.nights,
                    idempotencyKey = confirm.idempotencyKey,
                )
            ) {
                is GuardianResult.Ok -> {
                    _state.value = _state.value.copy(
                        book = BookFlow.Booked(r.value.reference, r.value.amountUsd),
                    )
                    refresh() // the new trip appears in My Trips
                }
                is GuardianResult.Err ->
                    _state.value = _state.value.copy(book = BookFlow.Failed(r.message))
            }
        }
    }

    fun dismissBooking() {
        _state.value = _state.value.copy(book = BookFlow.Idle)
    }
}
