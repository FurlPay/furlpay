package com.furlpay.guardian.sync

import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.EventSource
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.model.TravelBooking
import com.furlpay.guardian.domain.model.Wallet
import com.furlpay.guardian.domain.model.WalletOverview
import kotlinx.datetime.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Phone ↔ watch wire contract. One place, both apps — paths, keys, and the
 * serializable snapshot shapes. Bump [VERSION] on breaking payload changes;
 * a receiver that sees a newer version renders its "update the phone app"
 * state instead of crashing on a parse.
 */
object SyncProtocol {

    const val VERSION = 1

    // MessageClient (fire-and-forget, watch → phone)
    const val MSG_VOICE_COMMAND = "/guardian/voice-command"
    const val MSG_REFRESH_REQUEST = "/guardian/refresh-request"

    // DataClient (latest-value sync, phone → watch)
    const val DATA_VOICE_RESPONSE = "/guardian/voice-response"
    const val DATA_WALLET = "/guardian/wallet"
    const val DATA_EVENTS = "/guardian/events"
    const val DATA_TRIPS = "/guardian/trips"
    const val DATA_PORTFOLIO = "/guardian/portfolio"
    const val DATA_SPENDING = "/guardian/spending"

    /**
     * Session JWT hand-off phone → watch, so the watch can call furlpay.com
     * directly when the phone is out of reach. Rides the Data Layer (encrypted
     * transport over the paired-device channel); the watch immediately seals
     * it into its own KeystoreTokenStore and relies on the server-side 1h
     * expiry + refresh, exactly like the phone.
     */
    const val DATA_AUTH_TOKEN = "/guardian/auth-token"

    // DataMap keys
    const val KEY_JSON = "json"
    const val KEY_VERSION = "v"
    /** Update stamp — also forces a DataItem delta when the payload repeats. */
    const val KEY_SENT_AT = "sentAt"

    val json: Json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        encodeDefaults = true
    }
}

// ---------------------------------------------------------------------------
// Snapshots — deliberately small: a watch tile needs the headline, not the
// ledger. Domain models flatten in; the watch renders straight out.
// ---------------------------------------------------------------------------

@Serializable
data class WalletSnapshot(
    val totalUsd: Double,
    val top: List<WalletItem>,
    val updatedAtMs: Long,
) {
    @Serializable
    data class WalletItem(val currency: String, val usdValue: Double, val chain: String? = null)

    companion object {
        fun from(overview: WalletOverview, now: Instant, topN: Int = 5) = WalletSnapshot(
            totalUsd = overview.totalUsd,
            top = overview.wallets.take(topN).map { WalletItem(it.currency, it.usdValue, it.chain) },
            updatedAtMs = now.toEpochMilliseconds(),
        )
    }

    fun toWallets(): List<Wallet> = top.mapIndexed { i, item ->
        Wallet(id = "sync-$i", currency = item.currency, balance = 0.0, usdValue = item.usdValue, chain = item.chain)
    }
}

@Serializable
data class EventsSnapshot(
    val events: List<EventItem>,
    val updatedAtMs: Long,
) {
    @Serializable
    data class EventItem(
        val id: String,
        val title: String,
        val detail: String? = null,
        val startAtMs: Long? = null,
        val priority: String,
        val source: String,
        val actionUrl: String? = null,
    )

    companion object {
        fun from(events: List<GuardianEvent>, now: Instant) = EventsSnapshot(
            events = events.map {
                EventItem(
                    id = it.id,
                    title = it.title,
                    detail = it.detail,
                    startAtMs = it.startAt?.toEpochMilliseconds(),
                    priority = it.priority.name,
                    source = it.source.name,
                    actionUrl = it.actionUrl,
                )
            },
            updatedAtMs = now.toEpochMilliseconds(),
        )
    }

    fun toEvents(): List<GuardianEvent> = events.map {
        GuardianEvent(
            id = it.id,
            source = runCatching { EventSource.valueOf(it.source) }.getOrDefault(EventSource.MANUAL),
            title = it.title,
            detail = it.detail,
            startAt = it.startAtMs?.let(Instant::fromEpochMilliseconds),
            priority = runCatching { EventPriority.valueOf(it.priority) }.getOrDefault(EventPriority.MEDIUM),
            actionUrl = it.actionUrl,
        )
    }
}

@Serializable
data class TripsSnapshot(
    val trips: List<TripItem>,
    val updatedAtMs: Long,
) {
    @Serializable
    data class TripItem(
        val id: String,
        val title: String,
        val startAtMs: Long,
        val detail: String? = null,
        val reference: String? = null,
    )

    companion object {
        fun from(bookings: List<TravelBooking>, now: Instant) = TripsSnapshot(
            trips = bookings.map {
                TripItem(it.id, it.title, it.startAt.toEpochMilliseconds(), it.detail, it.reference)
            },
            updatedAtMs = now.toEpochMilliseconds(),
        )
    }
}

@Serializable
data class PortfolioSnapshot(
    val totalUsd: Double,
    val dayChangeUsd: Double,
    val dayChangePct: Double,
    val topMoverSymbol: String? = null,
    val topMoverPct: Double? = null,
    val updatedAtMs: Long,
) {
    companion object {
        fun from(portfolio: com.furlpay.guardian.domain.model.Portfolio, now: Instant) =
            PortfolioSnapshot(
                totalUsd = portfolio.totalUsd,
                dayChangeUsd = portfolio.dayChangeUsd,
                dayChangePct = portfolio.dayChangePct,
                topMoverSymbol = portfolio.topMover?.symbol,
                topMoverPct = portfolio.topMover?.dayChangePct,
                updatedAtMs = now.toEpochMilliseconds(),
            )
    }
}

/** Today/week spend, phone-computed from the ledger (DailySpend complication). */
@Serializable
data class SpendingSnapshot(
    val todayUsd: Double,
    val todayCount: Int,
    val weekUsd: Double,
    val updatedAtMs: Long,
)

/** Phone's answer to a watch voice command. */
@Serializable
data class VoiceResponse(
    /** Correlates with the VoiceCommand.id the watch sent. */
    val requestId: String,
    val text: String,
    /** Domain hint for the response card icon: wallet/card/event/travel/error. */
    val kind: String = "generic",
    val atMs: Long,
)

/** Watch → phone voice command payload (MessageClient). */
@Serializable
data class VoiceCommand(
    val id: String,
    val text: String,
    val atMs: Long,
)
