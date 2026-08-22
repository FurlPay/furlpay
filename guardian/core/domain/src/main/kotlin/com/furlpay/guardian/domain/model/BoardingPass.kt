package com.furlpay.guardian.domain.model

import kotlinx.datetime.Clock
import kotlinx.datetime.Instant
import kotlin.math.roundToInt

/**
 * Port of apps/web/src/lib/travel/boardingPass.ts, and the direct counterpart
 * of ios/FurlPayGuardian/Shared/Models/BoardingPass.swift.
 *
 * Deliberately NOT folded into [TravelBooking]. That type models a booking as
 * the trips list needs it — a title, a window, a reference. A boarding pass is
 * the gate-side document (seat, gate, passenger name, a scannable id), and
 * widening one type to carry both would give every hotel stay a null seat and
 * every flight a null check-out.
 *
 * The derived numbers arrive from the server (minutesToBoarding, progress) AND
 * can be recomputed here from the absolute instants. Both exist on purpose: the
 * server's copy is what the list renders on arrival, and the local
 * recomputation is what keeps a screen honest after it has been open for
 * twenty minutes.
 */

/**
 * Where the flight is in its own timeline. The server owns this; the client
 * recomputes the same ladder from the same instants rather than inventing one.
 */
enum class FlightStatus(val wire: String, val label: String) {
    SCHEDULED("scheduled", "Scheduled"),
    BOARDING_SOON("boarding_soon", "Boarding Soon"),
    BOARDING("boarding", "Boarding"),
    DEPARTED("departed", "In the Air"),
    LANDED("landed", "Landed"),
    ;

    companion object {
        /**
         * Unknown wire values fall back to [SCHEDULED] rather than throwing: a
         * server that adds a status must not crash an installed app, and the
         * clock-derived [BoardingPass.statusAt] overrides this on every render
         * anyway.
         */
        fun fromWire(value: String?): FlightStatus =
            entries.firstOrNull { it.wire == value } ?: SCHEDULED
    }
}

/**
 * The flight as printed on the pass. Times are the airport's own local
 * wall-clock, formatted by the server — a client that re-derived them from the
 * instants would need every airport's timezone to get the arrival right.
 */
data class BoardingPassFlight(
    val number: String,
    val aircraft: String,
    val originCode: String,
    val originCity: String,
    val destinationCode: String,
    val destinationCity: String,
    val gate: String,
    val seat: String,
    val boardingTime: String,
    val departureTime: String,
    val arrivalTime: String,
)

data class BoardingPassPassenger(
    val name: String,
    val verified: Boolean,
)

data class BoardingPassPayment(
    val currency: String,
    val amount: Double,
    val rewardsRate: Double,
)

data class BoardingPass(
    val id: String,
    /** Trip headline, e.g. "Paris Trip". */
    val title: String,
    /** Route line under the title, e.g. "New York -> Paris". */
    val routeLabel: String,
    val flight: BoardingPassFlight,
    val passenger: BoardingPassPassenger,
    val payment: BoardingPassPayment,
    val boardingAt: Instant,
    val departsAt: Instant,
    val arrivesAt: Instant,
    /** The status at the instant the payload was built. Prefer [statusAt]. */
    val status: FlightStatus,
    val minutesToBoarding: Int?,
    val progress: Double,
) {
    companion object {
        /**
         * Same 30-minute window the server and the SwiftUI app use. Held in
         * MILLISECONDS because the comparison is a millisecond one: truncating
         * the gap to whole minutes would flip a pass 30m30s out to
         * "Boarding Soon" while web and iOS still called it "Scheduled".
         */
        const val BOARDING_SOON_WINDOW_MS: Long = 30L * 60_000L
    }
}

// ---------------------------------------------------------------------------
// Live derivation. Pure functions of (pass, now) so they are testable without a
// clock injection ceremony — callers that need "right now" omit the argument.
// ---------------------------------------------------------------------------

/**
 * Recomputed from the clock, so a screen left open cannot keep claiming
 * "boarding" for a flight that left an hour ago.
 */
fun BoardingPass.statusAt(now: Instant = Clock.System.now()): FlightStatus = when {
    now >= arrivesAt -> FlightStatus.LANDED
    now >= departsAt -> FlightStatus.DEPARTED
    now >= boardingAt -> FlightStatus.BOARDING
    (boardingAt - now).inWholeMilliseconds <= BoardingPass.BOARDING_SOON_WINDOW_MS ->
        FlightStatus.BOARDING_SOON
    else -> FlightStatus.SCHEDULED
}

/** Minutes until boarding, floored at 0. Null once boarding has started. */
fun BoardingPass.minutesToBoardingAt(now: Instant = Clock.System.now()): Int? {
    val deltaMs = (boardingAt - now).inWholeMilliseconds
    if (deltaMs <= 0) return null
    return maxOf(0, (deltaMs / 60_000.0).roundToInt())
}

/**
 * 0-1 along the route. Zero until the aircraft actually departs — a progress
 * line that creeps while the plane is still at the gate is a fabricated signal,
 * however good it looks.
 */
fun BoardingPass.routeProgressAt(now: Instant = Clock.System.now()): Double {
    val total = (arrivesAt - departsAt).inWholeMilliseconds
    if (now <= departsAt || total <= 0) return 0.0
    val flown = (now - departsAt).inWholeMilliseconds.toDouble() / total.toDouble()
    return flown.coerceIn(0.0, 1.0)
}

/** The one-line status the compact card shows. */
fun BoardingPass.statusLine(now: Instant = Clock.System.now()): String =
    when (statusAt(now)) {
        FlightStatus.SCHEDULED, FlightStatus.BOARDING_SOON -> {
            val minutes = minutesToBoardingAt(now)
            if (minutes == null) "Boarding now" else "Boarding in $minutes min"
        }
        FlightStatus.BOARDING -> "Boarding - Gate ${flight.gate}"
        FlightStatus.DEPARTED -> "In the air - lands ${flight.arrivalTime}"
        FlightStatus.LANDED -> "Landed ${flight.arrivalTime}"
    }

/** Route line for accessibility and share sheets. */
val BoardingPass.routeSummary: String
    get() = "${flight.originCode} to ${flight.destinationCode}"
