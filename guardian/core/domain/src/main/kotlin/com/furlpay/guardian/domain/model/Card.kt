package com.furlpay.guardian.domain.model

/**
 * Spend limits as `GET /api/cards` reports them (apps/web lib/types.ts
 * PaymentCard.limits). All USD. Null when the server omits the block.
 */
data class CardLimits(
    val perPurchaseUsd: Double,
    val dailyUsd: Double,
    val dailySpentUsd: Double,
)

/**
 * A FurlPay card as the watch sees it — mirrors the server's PaymentCard
 * minus presentation-only fields (gradient). Card numbers never leave the
 * server; only `last4` exists on-device.
 */
data class Card(
    val id: String,
    val last4: String,
    /** "virtual" or "physical". */
    val kind: String,
    /** "Visa" | "Mastercard". */
    val network: String? = null,
    val frozen: Boolean,
    /** Display label ("Metal Physical"); falls back to network + last4 in UI. */
    val label: String? = null,
    val limits: CardLimits? = null,
)
