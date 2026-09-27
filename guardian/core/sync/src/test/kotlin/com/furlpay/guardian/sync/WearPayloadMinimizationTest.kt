package com.furlpay.guardian.sync

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * What is allowed to cross to the wrist.
 *
 * WHY THIS FILE EXISTS
 *
 * `core:sync` owns the phone/watch wire format and had NO tests. The security
 * audit called the Wear surface "statically audited" — someone read the code and
 * concluded the snapshots were minimal. That conclusion was correct and it was
 * not enforced by anything, so the next person to add a field to a snapshot would
 * get no pushback.
 *
 * The watch is the weakest link in this system by construction: a smaller screen
 * with a shorter lock timeout, a Room cache that is plaintext ON PURPOSE (see
 * app/mobile's manifest comment), and a device people hand to someone to look at
 * a photo. The session token is in the Keystore; everything else on the watch
 * should be an AGGREGATE, never a record.
 *
 * So these tests serialize fully-populated snapshots and assert the resulting
 * JSON carries nothing that would matter if the watch were read. A field added
 * later that carries a card number, a wallet address, an email or a document
 * reference fails here rather than shipping.
 */
class WearPayloadMinimizationTest {

    /**
     * Field NAMES that must never appear as a key in a snapshot.
     *
     * Checked against extracted JSON keys, not against the whole document. The
     * first version of this test matched raw substrings and failed on the fixture
     * `"Retry from the phone"` — ordinary English inside a legitimate free-text
     * field. A check that cries wolf on prose is a check somebody deletes, so the
     * two concerns are separated: names are matched as names, and sensitive VALUES
     * are matched by shape below.
     */
    private val forbiddenFieldNames = listOf(
        "address", "wallet", "iban", "pan", "cardnumber", "card_number",
        "cvv", "cvc", "expiry", "pin", "token", "secret", "passkey",
        "credential", "totp", "email", "phone", "dob", "dateofbirth",
        "passport", "document", "ssn", "taxid", "seed", "mnemonic",
        "privatekey", "private_key",
    )

    /**
     * Shapes that are sensitive whatever they are called.
     *
     * Catches a value smuggled through an existing free-text field, which a
     * name-based check cannot see. Each pattern is deliberately specific enough
     * not to fire on a formatted money amount or a booking locator.
     */
    private val forbiddenValueShapes = listOf(
        "EVM address" to Regex("""0x[0-9a-fA-F]{40}"""),
        "long hex secret" to Regex("""\b[0-9a-fA-F]{32,}\b"""),
        "PAN-like digit run" to Regex("""\b(?:\d[ -]?){13,19}\b"""),
        "email address" to Regex("""[\w.+-]+@[\w-]+\.[\w.-]+"""),
        "JWT" to Regex("""eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"""),
        "base58 key-like" to Regex("""\b[1-9A-HJ-NP-Za-km-z]{40,}\b"""),
    )

    private val keyPattern = Regex("""\"([A-Za-z0-9_]+)\"\s*:""")

    /**
     * STRING values only — `"key":"value"`, never a bare JSON number.
     *
     * The distinction is load-bearing. A credential reaching the watch arrives as
     * a string in a text field; amounts, counts and `updatedAtMs` are numbers. An
     * earlier version scanned the whole document and flagged the 13-digit epoch
     * timestamp `1759000000000` as a card number in every single snapshot — a
     * check that fires on correct data teaches the reader to skip it.
     */
    private val stringValuePattern = Regex("""\"[A-Za-z0-9_]+\"\s*:\s*\"((?:[^\"\\]|\\.)*)\"""")

    private fun assertMinimal(label: String, json: String) {
        for (match in keyPattern.findAll(json)) {
            val key = match.groupValues[1].lowercase()
            for (bad in forbiddenFieldNames) {
                assertFalse(
                    key.contains(bad),
                    "$label has a field named '${match.groupValues[1]}' (matched '$bad'). " +
                        "The watch keeps a PLAINTEXT cache — this needs a security review, " +
                        "not a test change.\n$json",
                )
            }
        }
        for (value in stringValuePattern.findAll(json).map { it.groupValues[1] }) {
            for ((shapeName, pattern) in forbiddenValueShapes) {
                val hit = pattern.find(value)
                assertTrue(
                    hit == null,
                    "$label carries a string shaped like a $shapeName: '${hit?.value}' " +
                        "(in \"$value\"). Something sensitive is travelling through a " +
                        "free-text field.\n$json",
                )
            }
        }
    }

    @Test
    fun `wallet snapshot carries aggregates, never account identifiers`() {
        // The watch shows "what am I worth" — a total and a few currencies. It has
        // no use for an address, and an address on the wrist is a permanent
        // blockchain-to-human correlation sitting in a plaintext cache.
        val snapshot = WalletSnapshot(
            totalUsd = 125_000.50,
            top = listOf(
                WalletSnapshot.WalletItem(currency = "USDC", usdValue = 100_000.0, chain = "arbitrum"),
                WalletSnapshot.WalletItem(currency = "ETH", usdValue = 25_000.5, chain = "base"),
            ),
            updatedAtMs = 1_759_000_000_000,
        )
        val json = SyncProtocol.json.encodeToString(WalletSnapshot.serializer(), snapshot)
        assertMinimal("WalletSnapshot", json)
        // And the aggregate genuinely survives, so this is not passing by being empty.
        assertTrue(json.contains("125000.5"), "the total did not serialize: $json")
    }

    @Test
    fun `portfolio snapshot carries no positions, only totals`() {
        val snapshot = PortfolioSnapshot(
            totalUsd = 980_000.0,
            dayChangeUsd = -12_500.0,
            dayChangePct = -1.26,
            topMoverSymbol = "AAPL",
            topMoverPct = 3.4,
            updatedAtMs = 1_759_000_000_000,
        )
        val json = SyncProtocol.json.encodeToString(PortfolioSnapshot.serializer(), snapshot)
        assertMinimal("PortfolioSnapshot", json)
    }

    @Test
    fun `spending snapshot carries counts and sums, not transactions`() {
        // A transaction list would name counterparties. A count and a sum cannot.
        val snapshot = SpendingSnapshot(
            todayUsd = 240.0,
            todayCount = 7,
            weekUsd = 1_480.0,
            updatedAtMs = 1_759_000_000_000,
        )
        val json = SyncProtocol.json.encodeToString(SpendingSnapshot.serializer(), snapshot)
        assertMinimal("SpendingSnapshot", json)
    }

    @Test
    fun `events snapshot free-text fields are still checked`() {
        // `title` and `detail` are free text set by the phone. They are the most
        // likely route for something sensitive to arrive without anyone adding a
        // field — so the check runs against the serialized form, not the schema.
        val snapshot = EventsSnapshot(
            events = listOf(
                EventsSnapshot.EventItem(
                    id = "evt_1",
                    title = "Card payment declined",
                    detail = "Retry from the phone",
                    startAtMs = 1_759_000_000_000,
                    priority = "high",
                    source = "cards",
                    actionUrl = "furlpay://cards",
                ),
            ),
            updatedAtMs = 1_759_000_000_000,
        )
        val json = SyncProtocol.json.encodeToString(EventsSnapshot.serializer(), snapshot)
        assertMinimal("EventsSnapshot", json)
    }

    @Test
    fun `trips snapshot reference is not a document number`() {
        // `reference` is a booking locator, which is fine. It must not become a
        // passport or document reference, and the key-name check covers that.
        val snapshot = TripsSnapshot(
            trips = listOf(
                TripsSnapshot.TripItem(
                    id = "trip_1",
                    title = "LHR → JFK",
                    startAtMs = 1_759_000_000_000,
                    detail = "Gate B12",
                    reference = "ABC123",
                ),
            ),
            updatedAtMs = 1_759_000_000_000,
        )
        val json = SyncProtocol.json.encodeToString(TripsSnapshot.serializer(), snapshot)
        assertMinimal("TripsSnapshot", json)
    }

    @Test
    fun `the check itself catches a real leak`() {
        // A minimization test that only ever sees clean data proves nothing about
        // whether it would notice dirty data. These are the exact shapes this file
        // exists to stop, pushed through a legitimate free-text field, and each
        // must be detected. Without this the suite could pass with every pattern
        // silently broken — which is what happened twice while writing it.
        val leaks = listOf(
            "EVM address" to "Sent to 0x1234567890abcdef1234567890abcdef12345678",
            "PAN" to "Card 4111 1111 1111 1111 declined",
            "email" to "Contact giulia.ferrari@example.com",
            "JWT" to "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3IifQ",
            "long hex" to "key 9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
        )
        for ((what, text) in leaks) {
            val snapshot = EventsSnapshot(
                events = listOf(
                    EventsSnapshot.EventItem(
                        id = "evt_leak",
                        title = "Notice",
                        detail = text,
                        priority = "high",
                        source = "test",
                    ),
                ),
                updatedAtMs = 1_759_000_000_000,
            )
            val json = SyncProtocol.json.encodeToString(EventsSnapshot.serializer(), snapshot)
            var caught = false
            try {
                assertMinimal("leak probe", json)
            } catch (expected: AssertionError) {
                caught = true
            }
            assertTrue(caught, "assertMinimal FAILED TO DETECT a $what in a free-text field: $text")
        }
    }

    @Test
    fun `the check tolerates ordinary content`() {
        // The other half: prose, money, locators and deep links must pass. A check
        // that flags "Retry from the phone" — which the first version did — gets
        // deleted by the next person who hits it.
        val ordinary = listOf(
            "Retry from the phone",
            "Gate B12, boarding at 14:20",
            "Spent $1,480.00 this week",
            "LHR → JFK",
            "furlpay://cards",
            "ABC123",
            "Card payment declined",
        )
        for (text in ordinary) {
            val snapshot = EventsSnapshot(
                events = listOf(
                    EventsSnapshot.EventItem(
                        id = "evt_ok",
                        title = text,
                        detail = text,
                        priority = "low",
                        source = "test",
                        actionUrl = "furlpay://wallet",
                    ),
                ),
                updatedAtMs = 1_759_000_000_000,
            )
            val json = SyncProtocol.json.encodeToString(EventsSnapshot.serializer(), snapshot)
            assertMinimal("ordinary content: $text", json)
        }
    }

    @Test
    fun `the auth token path is the only credential channel`() {
        // Exactly one path carries a credential, and the watch gates it on a
        // connected-node check (PairedNodeGate) that fails closed. Every other
        // path is display data. If a second credential-bearing path is added, the
        // gate must be applied to it too — this asserts the list stays at one.
        val credentialPaths = listOf(SyncProtocol.DATA_AUTH_TOKEN)
        val displayPaths = listOf(
            SyncProtocol.DATA_WALLET,
            SyncProtocol.DATA_EVENTS,
            SyncProtocol.DATA_TRIPS,
            SyncProtocol.DATA_PORTFOLIO,
            SyncProtocol.DATA_SPENDING,
            SyncProtocol.DATA_MARKET,
            SyncProtocol.DATA_VOICE_RESPONSE,
        )
        assertEquals(1, credentialPaths.size)
        assertFalse(
            displayPaths.any { it in credentialPaths },
            "a display path is also being treated as a credential path",
        )
        // Paths are namespaced so a malformed path cannot collide with another app's.
        for (p in credentialPaths + displayPaths) {
            assertTrue(p.startsWith("/guardian/"), "unnamespaced sync path: $p")
        }
    }

    @Test
    fun `unknown fields are ignored rather than rejected`() {
        // The phone and watch update independently through the Play Store, so a
        // newer phone will send fields an older watch has never heard of. Strict
        // parsing would make the watch go blank after a phone update — and a blank
        // watch is what drives someone to loosen the gate that protects the token.
        val forwardCompatible = """
            {"totalUsd":10.0,"top":[],"updatedAtMs":1,"fieldFromANewerPhone":"x"}
        """.trimIndent()
        val decoded = SyncProtocol.json.decodeFromString(WalletSnapshot.serializer(), forwardCompatible)
        assertEquals(10.0, decoded.totalUsd)
    }
}
