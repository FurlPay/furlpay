package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.action.Confirmation
import com.furlpay.guardian.domain.action.GuardianActionRegistry
import com.furlpay.guardian.domain.action.ResolvedConfirmation
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Mirrors native-app/lib/copilotActions.ts semantics — if a case passes there
 * it must pass here, and every rejection reason class is covered. This is the
 * security boundary between "the model proposed X" and "X executes".
 */
class GuardianActionRegistryTest {

    private fun cardControl(
        action: String? = "card_control",
        endpoint: String = "/cards/settings",
        method: String? = "POST",
        body: kotlinx.serialization.json.JsonObject? = buildJsonObject {
            put("cardId", "card-123")
            put("freeze", true)
        },
    ) = Confirmation(action = action, endpoint = endpoint, method = method, body = body, summary = "Freeze card")

    @Test
    fun `valid card_control resolves with body rebuilt from registry`() {
        val resolved = GuardianActionRegistry.resolve(cardControl())
        val ok = assertIs<ResolvedConfirmation.Ok>(resolved)
        assertEquals("/cards/settings", ok.endpoint)
        assertEquals("POST", ok.method)
        assertEquals(setOf("cardId", "freeze"), ok.body.keys)
        assertEquals(listOf("Card" to "card-123", "Freeze" to "true"), ok.details.map { it.label to it.value })
    }

    @Test
    fun `unknown action is rejected`() {
        val resolved = GuardianActionRegistry.resolve(cardControl(action = "drain_wallet"))
        assertIs<ResolvedConfirmation.Rejected>(resolved)
    }

    @Test
    fun `missing action is rejected`() {
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(cardControl(action = null)))
    }

    @Test
    fun `endpoint mismatch is rejected even for a known action`() {
        val resolved = GuardianActionRegistry.resolve(cardControl(endpoint = "/payments/create"))
        assertIs<ResolvedConfirmation.Rejected>(resolved)
    }

    @Test
    fun `api-prefixed endpoint is normalized and accepted`() {
        val resolved = GuardianActionRegistry.resolve(cardControl(endpoint = "/api/cards/settings"))
        assertIs<ResolvedConfirmation.Ok>(resolved)
    }

    @Test
    fun `method mismatch is rejected`() {
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(cardControl(method = "DELETE")))
    }

    @Test
    fun `null method defaults to POST and is accepted`() {
        assertIs<ResolvedConfirmation.Ok>(GuardianActionRegistry.resolve(cardControl(method = null)))
    }

    @Test
    fun `missing body is rejected`() {
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(cardControl(body = null)))
    }

    @Test
    fun `missing required field is rejected`() {
        val body = buildJsonObject { put("cardId", "card-123") } // no freeze
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(cardControl(body = body)))
    }

    @Test
    fun `wrong field type is rejected`() {
        val body = buildJsonObject {
            put("cardId", "card-123")
            put("freeze", "yes") // string, not boolean
        }
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(cardControl(body = body)))
    }

    @Test
    fun `extra keys the model sent are dropped from the rebuilt body`() {
        val body = buildJsonObject {
            put("cardId", "card-123")
            put("freeze", true)
            put("adminOverride", true) // injected — must not survive
        }
        val ok = assertIs<ResolvedConfirmation.Ok>(GuardianActionRegistry.resolve(cardControl(body = body)))
        assertNull(ok.body["adminOverride"])
    }

    // ── money bounds ────────────────────────────────────────────────────────

    private fun payment(amount: Double, recipient: String = "0x" + "a".repeat(40)) = Confirmation(
        action = "send_payment",
        endpoint = "/payments/create",
        body = buildJsonObject {
            put("amount", amount)
            put("recipient", recipient)
            put("sourceChain", "arbitrum")
        },
        summary = "Send payment",
    )

    @Test
    fun `payment at the ceiling passes, one cent above is rejected`() {
        assertIs<ResolvedConfirmation.Ok>(GuardianActionRegistry.resolve(payment(25_000.0)))
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(payment(25_000.01)))
    }

    @Test
    fun `payment below the minimum is rejected`() {
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(payment(0.001)))
    }

    @Test
    fun `non-finite amount is rejected`() {
        val body = buildJsonObject {
            put("amount", JsonPrimitive(Double.NaN))
            put("recipient", "0x" + "a".repeat(40))
            put("sourceChain", "arbitrum")
        }
        val c = Confirmation(action = "send_payment", endpoint = "/payments/create", body = body, summary = "")
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(c))
    }

    @Test
    fun `malformed recipient address is rejected`() {
        assertIs<ResolvedConfirmation.Rejected>(
            GuardianActionRegistry.resolve(payment(10.0, recipient = "0xnot-an-address")),
        )
    }

    @Test
    fun `usd amounts render with grouping in details`() {
        val ok = assertIs<ResolvedConfirmation.Ok>(GuardianActionRegistry.resolve(payment(25_000.0)))
        assertEquals("$25,000", ok.details.first { it.label == "Amount" }.value)
        val ok2 = assertIs<ResolvedConfirmation.Ok>(GuardianActionRegistry.resolve(payment(87.30)))
        assertEquals("$87.3", ok2.details.first { it.label == "Amount" }.value)
    }

    // ── enums / optionals ───────────────────────────────────────────────────

    @Test
    fun `unsupported enum value is rejected`() {
        val c = Confirmation(
            action = "earn_deposit",
            endpoint = "/earn/deposit",
            body = buildJsonObject {
                put("token", "DOGE") // not a stablecoin in the allowlist
                put("amountUsd", 100.0)
            },
            summary = "",
        )
        assertIs<ResolvedConfirmation.Rejected>(GuardianActionRegistry.resolve(c))
    }

    @Test
    fun `optional field may be omitted`() {
        val c = Confirmation(
            action = "execute_swap",
            endpoint = "/swaps",
            body = buildJsonObject {
                put("fromToken", "USDC")
                put("toToken", "USDT")
                put("fromChain", "base")
                // toChain omitted — optional
                put("amountIn", 50.0)
            },
            summary = "",
        )
        val ok = assertIs<ResolvedConfirmation.Ok>(GuardianActionRegistry.resolve(c))
        assertNull(ok.body["toChain"])
    }

    @Test
    fun `registry ids match the mutating-tool gate expectations`() {
        // Every registry action mutates state server-side; none may execute
        // without confirmation. Guard against someone adding a GET-shaped one.
        assertTrue(GuardianActionRegistry.all.values.all { it.method == "POST" })
    }
}
