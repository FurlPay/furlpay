package com.furlpay.guardian.domain.action

import java.util.Locale
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull

// ---------------------------------------------------------------------------
// Co-pilot / voice action allowlist — the Kotlin port of
// native-app/lib/copilotActions.ts, byte-for-byte in behavior.
//
// The AI (Gemini voice, /api/chat co-pilot, or a prompt-injected response) may
// PROPOSE an action, but it must never define arbitrary executable authority.
// Every confirmable action is declared here — exact id, exact endpoint, exact
// method, exact body schema — and anything that doesn't match is rejected
// before the biometric prompt is ever shown. The executable request is rebuilt
// FROM THE REGISTRY (allowed fields only); extra keys the model sent are
// dropped, and any mismatch rejects the whole action.
// ---------------------------------------------------------------------------

enum class FieldType { STRING, NUMBER, BOOLEAN }

data class FieldSpec(
    val type: FieldType,
    /** Label in the confirmation card; null for fields not worth showing. */
    val label: String? = null,
    /** Render as USD currency. */
    val usd: Boolean = false,
    /** Allowed values (exact match) for enum-like strings. */
    val oneOf: List<String>? = null,
    /** Regex the (string) value must fully match. */
    val pattern: Regex? = null,
    /** Bounds for numbers. */
    val min: Double? = null,
    val max: Double? = null,
    val optional: Boolean = false,
)

data class ActionSpec(
    val id: String,
    val title: String,
    /** Path as passed to the API client (no /api prefix). */
    val endpoint: String,
    val method: String = "POST",
    /** Disabled actions are rejected even if otherwise well-formed. */
    val enabled: Boolean = true,
    /** Iteration order is the confirmation-card render order. */
    val fields: Map<String, FieldSpec>,
)

/** Shape the server returns in `requiresConfirmation`. */
data class Confirmation(
    val action: String? = null,
    val endpoint: String = "",
    val method: String? = null,
    val body: JsonObject? = null,
    val summary: String = "",
    val amountUsd: Double? = null,
)

data class ConfirmationDetail(val label: String, val value: String)

sealed interface ResolvedConfirmation {
    data class Ok(
        val spec: ActionSpec,
        /** Exactly what will be sent — from the registry, never the raw payload. */
        val endpoint: String,
        val method: String,
        val body: JsonObject,
        val details: List<ConfirmationDetail>,
    ) : ResolvedConfirmation

    data class Rejected(val reason: String) : ResolvedConfirmation
}

object GuardianActionRegistry {

    /**
     * Per-action USD ceiling — a co-pilot/voice confirmation is a convenience
     * path, not the place for outsized transfers. Anything bigger goes through
     * the full phone UI flow.
     */
    const val MAX_ACTION_USD = 25_000.0

    private val EVM_ADDR = Regex("^0x[0-9a-fA-F]{40}$")
    private val STABLE = listOf("USDC", "USDT", "EURC", "PYUSD", "DAI")
    private val CHAINS = listOf("arbitrum", "base", "polygon", "ethereum", "solana")

    val all: Map<String, ActionSpec> = listOf(
        ActionSpec(
            id = "card_control",
            title = "Card control",
            endpoint = "/cards/settings",
            fields = linkedMapOf(
                "cardId" to FieldSpec(FieldType.STRING, label = "Card", pattern = Regex("^[\\w-]{1,64}$")),
                "freeze" to FieldSpec(FieldType.BOOLEAN, label = "Freeze"),
            ),
        ),
        ActionSpec(
            id = "earn_deposit",
            title = "Deposit into Earn",
            endpoint = "/earn/deposit",
            fields = linkedMapOf(
                "token" to FieldSpec(FieldType.STRING, label = "Token", oneOf = STABLE),
                "amountUsd" to FieldSpec(FieldType.NUMBER, label = "Amount", usd = true, min = 0.01, max = MAX_ACTION_USD),
            ),
        ),
        ActionSpec(
            id = "schedule_dca",
            title = "Recurring investment",
            endpoint = "/investing/schedule",
            fields = linkedMapOf(
                "symbol" to FieldSpec(FieldType.STRING, label = "Asset", pattern = Regex("^[A-Z0-9.]{1,12}$")),
                "side" to FieldSpec(FieldType.STRING, label = "Side", oneOf = listOf("buy", "sell")),
                "notional" to FieldSpec(FieldType.NUMBER, label = "Amount", usd = true, min = 1.0, max = MAX_ACTION_USD),
                "cadence" to FieldSpec(FieldType.STRING, label = "Every", oneOf = listOf("day", "week", "month")),
            ),
        ),
        ActionSpec(
            id = "place_order",
            title = "Investment order",
            endpoint = "/investing/order",
            fields = linkedMapOf(
                "symbol" to FieldSpec(FieldType.STRING, label = "Asset", pattern = Regex("^[A-Z0-9.]{1,12}$")),
                "side" to FieldSpec(FieldType.STRING, label = "Side", oneOf = listOf("buy", "sell")),
                "notional" to FieldSpec(FieldType.NUMBER, label = "Amount", usd = true, min = 1.0, max = MAX_ACTION_USD),
            ),
        ),
        ActionSpec(
            id = "execute_swap",
            title = "Swap",
            endpoint = "/swaps",
            fields = linkedMapOf(
                "fromToken" to FieldSpec(FieldType.STRING, label = "From", oneOf = STABLE),
                "toToken" to FieldSpec(FieldType.STRING, label = "To", oneOf = STABLE),
                "fromChain" to FieldSpec(FieldType.STRING, label = "Chain", oneOf = CHAINS),
                "toChain" to FieldSpec(FieldType.STRING, label = "To chain", oneOf = CHAINS, optional = true),
                "amountIn" to FieldSpec(FieldType.NUMBER, label = "Amount", usd = true, min = 0.01, max = MAX_ACTION_USD),
            ),
        ),
        ActionSpec(
            id = "send_payment",
            title = "Send payment",
            endpoint = "/payments/create",
            fields = linkedMapOf(
                "amount" to FieldSpec(FieldType.NUMBER, label = "Amount", usd = true, min = 0.01, max = MAX_ACTION_USD),
                "recipient" to FieldSpec(FieldType.STRING, label = "Recipient", pattern = EVM_ADDR),
                "sourceChain" to FieldSpec(FieldType.STRING, label = "Chain", oneOf = CHAINS),
            ),
        ),
        ActionSpec(
            id = "create_support_ticket",
            title = "Open a support ticket",
            endpoint = "/support/tickets",
            fields = linkedMapOf(
                "category" to FieldSpec(
                    FieldType.STRING,
                    label = "Category",
                    oneOf = listOf("stablecoins", "cards", "kyc", "travel", "developers", "other"),
                ),
                "subject" to FieldSpec(FieldType.STRING, label = "Subject", pattern = Regex("^[\\s\\S]{4,120}$")),
                "body" to FieldSpec(FieldType.STRING, pattern = Regex("^[\\s\\S]{1,5000}$")),
            ),
        ),
    ).associateBy { it.id }

    private fun normalizeEndpoint(e: String): String =
        e.replace(Regex("^/api(?=/)"), "")

    /**
     * Validate a server/model confirmation against the allowlist. Returns the
     * executable request rebuilt from the registry, or the reason it was
     * refused. The caller must ALSO gate mutating dispatch behind a biometric —
     * this function only decides whether the request is well-formed and allowed.
     */
    fun resolve(c: Confirmation): ResolvedConfirmation {
        val spec = c.action?.let { all[it] }
            ?: return ResolvedConfirmation.Rejected("Unknown co-pilot action \"${c.action ?: "(none)"}\".")
        if (!spec.enabled) {
            return ResolvedConfirmation.Rejected("The \"${spec.title}\" action is currently disabled.")
        }
        if (normalizeEndpoint(c.endpoint) != spec.endpoint) {
            return ResolvedConfirmation.Rejected("Endpoint mismatch for \"${spec.id}\" — refusing to execute.")
        }
        if ((c.method ?: "POST") != spec.method) {
            return ResolvedConfirmation.Rejected("Method mismatch for \"${spec.id}\" — refusing to execute.")
        }
        val raw = c.body
            ?: return ResolvedConfirmation.Rejected("Malformed confirmation body.")

        val details = mutableListOf<ConfirmationDetail>()
        val body = buildJsonObject {
            for ((key, field) in spec.fields) {
                val value = raw[key]
                if (value == null || value is JsonNull) {
                    if (field.optional) continue
                    return ResolvedConfirmation.Rejected(
                        "Missing \"$key\" in the ${spec.title.lowercase()} details.",
                    )
                }
                val prim = value as? JsonPrimitive
                    ?: return ResolvedConfirmation.Rejected(
                        "Invalid \"$key\" in the ${spec.title.lowercase()} details.",
                    )

                when (field.type) {
                    FieldType.STRING -> {
                        if (!prim.isString) {
                            return ResolvedConfirmation.Rejected(
                                "Invalid \"$key\" in the ${spec.title.lowercase()} details.",
                            )
                        }
                        val s = prim.content
                        if (field.oneOf != null && s !in field.oneOf) {
                            return ResolvedConfirmation.Rejected("Unsupported \"$key\" value.")
                        }
                        if (field.pattern != null && !field.pattern.matches(s)) {
                            return ResolvedConfirmation.Rejected("Invalid \"$key\" value.")
                        }
                        put(key, prim)
                        field.label?.let { details += ConfirmationDetail(it, s) }
                    }

                    FieldType.BOOLEAN -> {
                        val b = if (prim.isString) null else prim.booleanOrNull
                        if (b == null) {
                            return ResolvedConfirmation.Rejected(
                                "Invalid \"$key\" in the ${spec.title.lowercase()} details.",
                            )
                        }
                        put(key, prim)
                        field.label?.let { details += ConfirmationDetail(it, b.toString()) }
                    }

                    FieldType.NUMBER -> {
                        val n = if (prim.isString) null else prim.doubleOrNull
                        if (n == null || !n.isFinite()) {
                            return ResolvedConfirmation.Rejected("Invalid \"$key\" amount.")
                        }
                        if (field.min != null && n < field.min) {
                            return ResolvedConfirmation.Rejected("\"$key\" is below the minimum.")
                        }
                        if (field.max != null && n > field.max) {
                            return ResolvedConfirmation.Rejected(
                                "That amount is above the co-pilot limit — use the full flow instead.",
                            )
                        }
                        put(key, prim)
                        field.label?.let {
                            details += ConfirmationDetail(it, if (field.usd) formatUsd(n) else n.toString())
                        }
                    }
                }
            }
        }

        return ResolvedConfirmation.Ok(
            spec = spec,
            endpoint = spec.endpoint,
            method = spec.method,
            body = body,
            details = details,
        )
    }

    /** "$25,000" / "$87.30" — mirrors toLocaleString("en-US", {maxFrac: 2}). */
    private fun formatUsd(n: Double): String {
        val rounded = kotlin.math.round(n * 100) / 100
        val text = if (rounded == kotlin.math.floor(rounded) && kotlin.math.abs(rounded) < 1e15) {
            String.format(Locale.US, "%,.0f", rounded)
        } else {
            String.format(Locale.US, "%,.2f", rounded).trimEnd('0').trimEnd('.')
        }
        return "$$text"
    }
}
