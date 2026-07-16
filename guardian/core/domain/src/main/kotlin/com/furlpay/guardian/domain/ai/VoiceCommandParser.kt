package com.furlpay.guardian.domain.ai

// ---------------------------------------------------------------------------
// Deterministic first-pass voice intent parser. The watch's voice commands
// follow a tight schema ("what's my balance", "freeze my card ending 4521"),
// and for those the answer must not depend on an LLM being reachable — the
// rule decides, the model is only the fallback for phrasing the rules don't
// cover. Returns null when no rule matches; the caller escalates to Gemini.
// ---------------------------------------------------------------------------

/** A parsed intent: which catalog tool to run and with what arguments. */
data class ToolInvocation(val tool: GuardianTool, val args: Map<String, String>) {
    val requiresConfirmation: Boolean get() = tool.mutating
}

object VoiceCommandParser {

    private val KNOWN_CURRENCIES =
        listOf("USDC", "USDT", "EURC", "PYUSD", "DAI", "ETH", "SOL", "BTC", "USD", "EUR")

    private val LAST4 = Regex("\\b(\\d{4})\\b")

    fun parse(raw: String): ToolInvocation? {
        val text = raw.trim().lowercase()
        if (text.isBlank()) return null

        return parseFreeze(text)
            ?: parseSpending(text)
            ?: parseBalance(text)
            ?: parsePortfolio(text)
            ?: parseTravel(text)
            ?: parseNextEvent(text)
            ?: parseReminder(raw)
    }

    private fun tool(name: String): GuardianTool =
        GuardianTools.byName(name) ?: error("Tool $name missing from catalog")

    // "freeze my card ending 4521" / "unfreeze my visa 4521" / "lock card 4521"
    private fun parseFreeze(text: String): ToolInvocation? {
        val mentionsCard = "card" in text || "visa" in text || "mastercard" in text
        val freezes = "freeze" in text || "lock" in text
        if (!mentionsCard || !freezes) return null
        // Without the last4 we refuse to guess which card — the LLM path (or
        // the UI) must disambiguate. Never freeze "some" card.
        val last4 = LAST4.find(text)?.groupValues?.get(1) ?: return null
        val unfreeze = "unfreeze" in text || "unlock" in text
        return ToolInvocation(
            tool = tool("freezeCard"),
            args = mapOf("last4" to last4, "freeze" to (!unfreeze).toString()),
        )
    }

    // "how much did I spend today" / "what's my weekly spend"
    private fun parseSpending(text: String): ToolInvocation? {
        if ("spend" !in text && "spent" !in text && "spending" !in text) return null
        val period = when {
            "week" in text -> "this_week"
            "month" in text -> "this_month"
            else -> "today"
        }
        return ToolInvocation(tool("getSpending"), mapOf("period" to period))
    }

    // "what's my balance" / "how much ETH do I have"
    private fun parseBalance(text: String): ToolInvocation? {
        val asksBalance = "balance" in text ||
            (("how much" in text || "how many" in text) && ("have" in text || "hold" in text))
        if (!asksBalance) return null
        val currency = KNOWN_CURRENCIES.firstOrNull { it.lowercase() in text }
        return ToolInvocation(
            tool("checkBalance"),
            currency?.let { mapOf("currency" to it) } ?: emptyMap(),
        )
    }

    // "how are my investments" / "portfolio"
    private fun parsePortfolio(text: String): ToolInvocation? {
        if ("portfolio" !in text && "investment" !in text && "stocks" !in text) return null
        return ToolInvocation(tool("getPortfolio"), emptyMap())
    }

    // "when's my next flight" / "hotel check-in info"
    private fun parseTravel(text: String): ToolInvocation? {
        val travelWords = listOf("flight", "hotel", "trip", "travel", "check-in", "boarding")
        if (travelWords.none { it in text }) return null
        return ToolInvocation(tool("getTravelInfo"), emptyMap())
    }

    // "what's my next meeting" / "what do I have today"
    private fun parseNextEvent(text: String): ToolInvocation? {
        val eventWords = listOf("next meeting", "next event", "calendar", "schedule", "what do i have")
        if (eventWords.none { it in text }) return null
        return ToolInvocation(tool("getNextEvent"), emptyMap())
    }

    // "remind me to call Mom at 6pm" — keeps the ORIGINAL casing for the title.
    private fun parseReminder(raw: String): ToolInvocation? {
        val match = Regex(
            "remind me to (.+?)(?: at | by | on )(.+)",
            RegexOption.IGNORE_CASE,
        ).find(raw.trim()) ?: return null

        val (title, time) = match.destructured
        val lower = raw.lowercase()
        val priority = when {
            "critical" in lower || "urgent" in lower -> "critical"
            "important" in lower -> "high"
            else -> "medium"
        }
        return ToolInvocation(
            tool("setReminder"),
            mapOf("title" to title.trim(), "time" to time.trim(), "priority" to priority),
        )
    }
}
