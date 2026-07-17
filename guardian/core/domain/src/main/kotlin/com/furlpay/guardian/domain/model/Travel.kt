package com.furlpay.guardian.domain.model

/**
 * Travel commerce surface — mirrors native-app/lib/travel.ts. Server owns all
 * pricing: the watch submits identifiers (propertyId/roomIndex/dates) plus an
 * idempotency key, never a client-computed total.
 */
data class TravelDeal(
    val id: String,
    val name: String,
    val city: String,
    val country: String,
    val stars: Int,
    val nightlyUsd: Double,
    val discountPct: Int,
    /** "USDC" | "SOL" | "BTC" */
    val payToken: String,
)

/** One flight offer from POST /api/travel/search {type:"flights"}. */
data class FlightOffer(
    val id: String,
    val carrier: String,
    val carrierCode: String,
    val from: String,
    val to: String,
    val date: String,
    val departTime: String,
    val arriveTime: String,
    val durationMin: Int,
    val stops: Int,
    val cabin: String,
    val priceUsd: Double,
    /** Brand SVG from the Duffel assets CDN, when live. */
    val logoUrl: String?,
)

/** A bookable stay (top result for a deal's city). */
data class StayOption(
    val id: String,
    val name: String,
    val city: String,
    val stars: Int,
    val rating: Double,
    val nightlyUsd: Double,
)

/** Server-confirmed booking — amountUsd is what was actually charged. */
data class BookingReceipt(
    val id: String,
    val reference: String,
    val status: String,
    val amountUsd: Double,
)

/** A trip row with the money detail the watch list shows. */
data class TripSummary(
    val id: String,
    val name: String,
    val city: String,
    val checkIn: String,
    val checkOut: String,
    val nights: Int,
    val amountUsd: Double,
    val method: String,
    val status: String,
)
