package com.furlpay.guardian.domain.model

/**
 * The three FurlPay card designs — the ones on furlpay.com/telegram, which the
 * server names as themes (apps/web cardLifecycle.ts CARD_THEMES) and the phone
 * app draws from native-app/lib/cards/designs.ts. Colours are 0xAARRGGBB and
 * lifted from the same stylesheet, so every surface draws the same card.
 *
 * A card whose gradient is not one of these three keeps whatever plain
 * treatment the screen already had; [from] returns null rather than guessing.
 */
enum class CardDesign(
    val displayName: String,
    /** Background stops, top-left to bottom-right. */
    val colors: List<Long>,
    /** Text and mark colour that stays readable on [colors]. */
    val ink: Long,
    val border: Long,
) {
    ELECTRIC(
        displayName = "Electric",
        colors = listOf(0xFF14197D, 0xFF1C24C5, 0xFF006BFF, 0xFF004CEA),
        ink = 0xFFFFFFFF,
        border = 0xFF5155EB,
    ),
    WORLD(
        displayName = "World",
        colors = listOf(0xFF060B21, 0xFF081432, 0xFF0B2A6B),
        ink = 0xFFFFFFFF,
        border = 0xFF4583D1,
    ),
    PEARL(
        displayName = "Pearl",
        colors = listOf(0xFFF1F0FF, 0xFFB8CBFF, 0xFFC7A7F8),
        ink = 0xFF353E6E,
        border = 0xFFE7E4FF,
    );

    companion object {
        // The two-colour gradient GET /api/cards publishes for each design.
        private val BY_GRADIENT = mapOf(
            "#14197d|#006bff" to ELECTRIC,
            "#060b21|#0b2a6b" to WORLD,
            "#f1f0ff|#c7a7f8" to PEARL,
        )

        fun from(gradient: List<String>?): CardDesign? {
            if (gradient == null || gradient.size != 2) return null
            return BY_GRADIENT[gradient[0].lowercase() + "|" + gradient[1].lowercase()]
        }
    }
}
