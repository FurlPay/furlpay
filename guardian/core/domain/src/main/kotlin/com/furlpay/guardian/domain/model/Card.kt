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
 * A FurlPay card as the watch sees it: it mirrors the server's PaymentCard.
 * Card numbers never leave the server; only `last4` exists on-device.
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
    /** The card's two theme colours ("#RRGGBB"); see [CardDesign.from]. */
    val gradient: List<String>? = null,
) {
    /** Which of the three FurlPay designs this card wears, if any. */
    val design: CardDesign? get() = CardDesign.from(gradient)
}
