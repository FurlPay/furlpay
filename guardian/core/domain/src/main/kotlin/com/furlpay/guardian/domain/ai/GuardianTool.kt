package com.furlpay.guardian.domain.ai

/**
 * Provider-neutral declaration of a voice/agent tool. The Firebase AI Logic
 * layer (in :app:mobile, where the SDK lives) maps each of these onto a
 * `FunctionDeclaration` / `Tool.autoFunction`; the SAME registry is what the
 * `@AppFunction` KDoc mirrors for system Gemini. Keeping the catalog here — in
 * pure Kotlin — means the tool surface is one testable source of truth, not
 * duplicated across the Live-API path and the AppFunctions path.
 *
 * SECURITY: `mutating` tools (freezeCard, setReminder) must be confirmed by the
 * human before execution — same human-in-the-loop rule the RN co-pilot enforces
 * via its allowlist. The registry marks them so the app layer can require a
 * biometric before dispatch.
 */
data class GuardianTool(
    val name: String,
    val description: String,
    val params: List<ToolParam>,
    val mutating: Boolean,
)

data class ToolParam(
    val name: String,
    val type: ParamType,
    val required: Boolean,
    val description: String,
)

enum class ParamType { STRING, BOOLEAN, INTEGER }

/** The canonical Guardian tool catalog. Mirrors the voice-command schema. */
object GuardianTools {
    val all: List<GuardianTool> = listOf(
        GuardianTool(
            name = "checkBalance",
            description = "Check wallet balances. Returns balances for all currencies or a specific one.",
            params = listOf(
                ToolParam("currency", ParamType.STRING, required = false, "Currency code, e.g. USDC. Omit for all."),
            ),
            mutating = false,
        ),
        GuardianTool(
            name = "freezeCard",
            description = "Freeze or unfreeze a FurlPay card. Requires the card's last 4 digits.",
            params = listOf(
                ToolParam("last4", ParamType.STRING, required = true, "Last 4 digits of the card."),
                ToolParam("freeze", ParamType.BOOLEAN, required = true, "true to freeze, false to unfreeze."),
            ),
            mutating = true,
        ),
        GuardianTool(
            name = "getSpending",
            description = "Get spending breakdown for a period: today, this_week, or this_month.",
            params = listOf(
                ToolParam("period", ParamType.STRING, required = true, "One of: today, this_week, this_month."),
            ),
            mutating = false,
        ),
        GuardianTool(
            name = "getPortfolio",
            description = "Get investment portfolio value, daily change, and top movers.",
            params = emptyList(),
            mutating = false,
        ),
        GuardianTool(
            name = "getNextEvent",
            description = "Get the next upcoming event, meeting, or deadline.",
            params = emptyList(),
            mutating = false,
        ),
        GuardianTool(
            name = "setReminder",
            description = "Set a reminder with a title, time, and priority (critical/high/medium/low).",
            params = listOf(
                ToolParam("title", ParamType.STRING, required = true, "What to remind the user about."),
                ToolParam("time", ParamType.STRING, required = true, "When — ISO 8601 or natural language."),
                ToolParam("priority", ParamType.STRING, required = true, "critical, high, medium, or low."),
            ),
            mutating = true,
        ),
        GuardianTool(
            name = "getTravelInfo",
            description = "Get upcoming travel: next flight details, hotel bookings, boarding passes.",
            params = emptyList(),
            mutating = false,
        ),
    )

    fun byName(name: String): GuardianTool? = all.firstOrNull { it.name == name }

    /** Tools that must be human-confirmed before dispatch. */
    val mutating: Set<String> = all.filter { it.mutating }.map { it.name }.toSet()
}
