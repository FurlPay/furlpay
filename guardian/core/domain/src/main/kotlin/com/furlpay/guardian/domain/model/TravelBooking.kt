package com.furlpay.guardian.domain.model

import kotlinx.datetime.Instant

enum class TravelKind { FLIGHT, HOTEL }

/**
 * A travel booking from `GET /api/travel/itineraries`, flattened to the two
 * facts the wrist needs: what it is and when it starts. Flight-specific bits
 * (gate, terminal) ride in [detail] as pre-formatted server text.
 */
data class TravelBooking(
    val id: String,
    val kind: TravelKind,
    /** "UA123 → SFO" or "Marriott Marquis". */
    val title: String,
    val startAt: Instant,
    val endAt: Instant? = null,
    /** Confirmation / booking reference shown at check-in. */
    val reference: String? = null,
    /** "Gate B7 · Terminal 2" — display-ready, no client parsing. */
    val detail: String? = null,
)
