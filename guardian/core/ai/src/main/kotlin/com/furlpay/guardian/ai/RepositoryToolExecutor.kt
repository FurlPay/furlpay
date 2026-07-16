package com.furlpay.guardian.ai

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.ai.GuardianToolExecutor
import com.furlpay.guardian.domain.ai.ToolInvocation
import com.furlpay.guardian.domain.ai.ToolReply
import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.EventSource
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.repository.CardRepository
import com.furlpay.guardian.domain.repository.EventRepository
import com.furlpay.guardian.domain.repository.PortfolioRepository
import com.furlpay.guardian.domain.repository.TransactionRepository
import com.furlpay.guardian.domain.repository.TravelRepository
import com.furlpay.guardian.domain.repository.WalletRepository
import java.util.Locale
import java.util.UUID
import kotlin.time.Duration.Companion.minutes
import kotlinx.datetime.Clock

/**
 * Runs catalog tools against the real repositories and phrases the answers
 * the way the watch speaks them. All numbers come from repositories — the
 * model never supplies a figure, only the phrasing around this reply.
 *
 * SECURITY: mutating tools go through [confirmMutating] — the app layer plugs
 * the biometric gate in there. The default refuses, so a mis-wired executor
 * fails closed.
 */
class RepositoryToolExecutor(
    private val wallets: WalletRepository,
    private val cards: CardRepository,
    private val transactions: TransactionRepository,
    private val portfolio: PortfolioRepository,
    private val travel: TravelRepository,
    private val events: EventRepository,
    private val clock: Clock = Clock.System,
    private val confirmMutating: suspend (ToolInvocation) -> Boolean = { false },
) : GuardianToolExecutor {

    override suspend fun execute(invocation: ToolInvocation): GuardianResult<ToolReply> {
        if (invocation.requiresConfirmation && !confirmMutating(invocation)) {
            return GuardianResult.Ok(
                ToolReply("That needs your confirmation on the device — cancelled for now.", "error"),
            )
        }
        return when (invocation.tool.name) {
            "checkBalance" -> checkBalance(invocation.args["currency"])
            "freezeCard" -> freezeCard(invocation.args)
            "getSpending" -> spending(invocation.args["period"])
            "getPortfolio" -> portfolioOverview()
            "getNextEvent" -> nextEvent()
            "setReminder" -> setReminder(invocation.args)
            "getTravelInfo" -> travelInfo()
            else -> GuardianResult.Err("Unknown tool \"${invocation.tool.name}\".")
        }
    }

    private suspend fun checkBalance(currency: String?): GuardianResult<ToolReply> =
        wallets.wallets().map { list ->
            if (currency != null) {
                val match = list.filter { it.currency.equals(currency, ignoreCase = true) }
                if (match.isEmpty()) {
                    ToolReply("No $currency balance found.", "wallet")
                } else {
                    val units = match.sumOf { it.balance }
                    val usd = match.sumOf { it.usdValue }
                    ToolReply("Your $currency balance is ${trim(units)}, worth ${usd(usd)}.", "wallet")
                }
            } else {
                val total = list.sumOf { it.usdValue }
                val top = list.sortedByDescending { it.usdValue }.take(3)
                    .joinToString(", ") { "${it.currency} ${usd(it.usdValue)}" }
                ToolReply("Total ${usd(total)}. Top: $top.", "wallet")
            }
        }

    private suspend fun freezeCard(args: Map<String, String>): GuardianResult<ToolReply> {
        val last4 = args["last4"] ?: return GuardianResult.Err("Which card? I need the last 4 digits.")
        val freeze = args["freeze"]?.toBooleanStrictOrNull() ?: true
        val card = when (val all = cards.cards()) {
            is GuardianResult.Err -> return all
            is GuardianResult.Ok -> all.value.firstOrNull { it.last4 == last4 }
                ?: return GuardianResult.Ok(ToolReply("No card ending $last4.", "error"))
        }
        return cards.setFrozen(card.id, freeze).map {
            ToolReply("Card ending $last4 is now ${if (it.frozen) "frozen" else "active"}.", "card")
        }
    }

    private suspend fun spending(periodWire: String?): GuardianResult<ToolReply> {
        val period = SpendingPeriod.fromWire(periodWire ?: "today") ?: SpendingPeriod.TODAY
        return transactions.spendingSummary(period).map { s ->
            val label = when (s.period) {
                SpendingPeriod.TODAY -> "today"
                SpendingPeriod.THIS_WEEK -> "this week"
                SpendingPeriod.THIS_MONTH -> "this month"
            }
            val txWord = if (s.transactionCount == 1) "transaction" else "transactions"
            ToolReply(
                "You've spent ${usd(s.totalUsd)} $label across ${s.transactionCount} $txWord.",
                "wallet",
            )
        }
    }

    private suspend fun portfolioOverview(): GuardianResult<ToolReply> =
        portfolio.overview().map { p ->
            val direction = if (p.dayChangeUsd >= 0) "up" else "down"
            val mover = p.topMover?.let {
                " Top mover: ${it.symbol} ${signedPct(it.dayChangePct)}."
            } ?: ""
            ToolReply(
                "Portfolio ${usd(p.totalUsd)}, $direction ${usd(kotlin.math.abs(p.dayChangeUsd))} " +
                    "today (${signedPct(p.dayChangePct)}).$mover",
                "wallet",
            )
        }

    private suspend fun nextEvent(): GuardianResult<ToolReply> =
        events.activeEvents().map { list ->
            val now = clock.now()
            val next = list
                .filter { it.startAt != null && it.startAt!! >= now }
                .minByOrNull { it.startAt!! }
                ?: return@map ToolReply("Nothing scheduled.", "event")
            val minutes = ((next.startAt!! - now).inWholeMinutes).coerceAtLeast(0)
            val whenText = when {
                minutes < 60 -> "in $minutes minutes"
                minutes < 24 * 60 -> "in ${minutes / 60}h ${minutes % 60}m"
                else -> "in ${minutes / (24 * 60)} days"
            }
            ToolReply("${next.title} $whenText.", "event")
        }

    private suspend fun setReminder(args: Map<String, String>): GuardianResult<ToolReply> {
        val title = args["title"] ?: return GuardianResult.Err("What should I remind you about?")
        val time = args["time"] ?: return GuardianResult.Err("When should I remind you?")
        val priority = when (args["priority"]?.lowercase()) {
            "critical" -> EventPriority.CRITICAL
            "high" -> EventPriority.HIGH
            "low" -> EventPriority.LOW
            else -> EventPriority.MEDIUM
        }
        // Natural-language time stays in `detail` until the phone-side parser
        // resolves it; a CRITICAL reminder still escalates via the alarm ladder
        // once armed with a concrete time.
        val event = GuardianEvent(
            id = "reminder-${UUID.randomUUID()}",
            source = EventSource.MANUAL,
            title = title,
            detail = "Remind at: $time",
            startAt = null,
            priority = priority,
        )
        return events.upsert(listOf(event)).map {
            val escalation = if (priority == EventPriority.CRITICAL) {
                " I'll escalate until you acknowledge."
            } else ""
            ToolReply("Reminder set: \"$title\" at $time (${priority.name.lowercase()}).$escalation", "event")
        }
    }

    private suspend fun travelInfo(): GuardianResult<ToolReply> =
        travel.upcoming().map { trips ->
            val next = trips.firstOrNull()
                ?: return@map ToolReply("No upcoming trips.", "travel")
            val extra = next.detail?.let { " — $it" } ?: ""
            ToolReply("${next.title}$extra. Ref: ${next.reference ?: "n/a"}.", "travel")
        }

    // ── formatting ──────────────────────────────────────────────────────────

    private fun usd(n: Double): String = "$" + String.format(Locale.US, "%,.2f", n)

    private fun signedPct(pct: Double): String =
        (if (pct >= 0) "+" else "") + String.format(Locale.US, "%.1f", pct) + "%"

    private fun trim(n: Double): String =
        if (n == kotlin.math.floor(n)) n.toLong().toString()
        else String.format(Locale.US, "%.4f", n).trimEnd('0').trimEnd('.')

    private inline fun <T, R> GuardianResult<T>.map(transform: (T) -> R): GuardianResult<R> =
        when (this) {
            is GuardianResult.Err -> this
            is GuardianResult.Ok -> GuardianResult.Ok(transform(value))
        }
}
