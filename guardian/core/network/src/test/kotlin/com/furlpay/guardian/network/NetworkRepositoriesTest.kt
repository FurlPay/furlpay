package com.furlpay.guardian.network

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.action.Confirmation
import com.furlpay.guardian.domain.action.GuardianActionRegistry
import com.furlpay.guardian.domain.action.ResolvedConfirmation
import com.furlpay.guardian.domain.model.BoardingPass
import com.furlpay.guardian.domain.model.FlightStatus
import com.furlpay.guardian.domain.model.SpendingPeriod
import com.furlpay.guardian.domain.model.TravelKind
import com.furlpay.guardian.network.repo.FurlPayCardRepository
import com.furlpay.guardian.network.repo.FurlPayTransactionRepository
import com.furlpay.guardian.network.repo.FurlPayTravelRepository
import com.furlpay.guardian.network.repo.FurlPayWalletRepository
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class NetworkRepositoriesTest {

    private lateinit var server: MockWebServer
    private lateinit var client: FurlPayClient

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = FurlPayClient(
            baseUrl = server.url("/api/").toString(),
            tokenStore = InMemoryTokenStore(fakeJwt(System.currentTimeMillis() + 3_600_000)),
        )
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `wallets map string amounts and unknown keys are ignored`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {"safeAddress":"0xabc","modules":[{"name":"PolicyGuard"}],
                 "balances":[
                   {"token":"USDC","amount":"1234.56","chain":"base","usdValue":1234.56},
                   {"token":"SOL","amount":"12.50","chain":"solana","usdValue":2000.0}
                 ]}
                """.trimIndent(),
            ),
        )

        val wallets = assertIs<GuardianResult.Ok<List<com.furlpay.guardian.domain.model.Wallet>>>(
            FurlPayWalletRepository(client.api).wallets(),
        ).value

        assertEquals(2, wallets.size)
        assertEquals(1234.56, wallets[0].balance)
        assertEquals("USDC:base", wallets[0].id)
    }

    @Test
    fun `setFrozen posts exactly cardId and freeze`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"success":true,"card":{"id":"card_1","kind":"virtual","last4":"4521","frozen":true,
                    "limits":{"perPurchase":500,"daily":2000,"dailySpent":87.3}}}""",
            ),
        )

        val card = assertIs<GuardianResult.Ok<com.furlpay.guardian.domain.model.Card>>(
            FurlPayCardRepository(client.api).setFrozen("card_1", freeze = true),
        ).value

        assertTrue(card.frozen)
        assertEquals(2000.0, card.limits?.dailyUsd)

        val sent = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(setOf("cardId", "freeze"), sent.keys)
        assertEquals("card_1", sent["cardId"]!!.jsonPrimitive.content)
    }

    @Test
    fun `spending summary is computed from the ledger`() = runTest {
        val today = kotlinx.datetime.Clock.System.now()
        server.enqueue(
            MockResponse().setBody(
                """
                {"transactions":[
                  {"id":"t1","direction":"out","title":"Coffee","amountUsd":5.5,
                   "timestamp":"$today","status":"settled","category":"food"},
                  {"id":"t2","direction":"in","title":"Payout","amountUsd":100.0,
                   "timestamp":"$today","status":"settled"}
                ]}
                """.trimIndent(),
            ),
        )

        val summary = assertIs<GuardianResult.Ok<com.furlpay.guardian.domain.model.SpendingSummary>>(
            FurlPayTransactionRepository(client.api).spendingSummary(SpendingPeriod.TODAY),
        ).value

        assertEquals(5.5, summary.totalUsd)
        assertEquals(1, summary.transactionCount)
        assertEquals("food", summary.topCategory)
    }

    @Test
    fun `trips become hotel bookings, date-only check-in parses`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {"upcoming":[{"id":"trip_1","name":"Marriott Marquis","city":"Singapore",
                  "checkIn":"2026-08-02","checkOut":"2026-08-05","nights":3,"status":"confirmed"}],
                 "past":[],"cancelled":[]}
                """.trimIndent(),
            ),
        )

        val bookings = assertIs<GuardianResult.Ok<List<com.furlpay.guardian.domain.model.TravelBooking>>>(
            FurlPayTravelRepository(client.api).upcoming(),
        ).value

        assertEquals(1, bookings.size)
        assertEquals(TravelKind.HOTEL, bookings[0].kind)
        assertEquals("Marriott Marquis", bookings[0].title)
        assertEquals("Singapore · 3 nights", bookings[0].detail)
    }

    @Test
    fun `boarding passes parse, sort by departure, and keep the derived fields`() = runTest {
        // Enqueued out of order on purpose: the screen shows the soonest
        // departure first, and it must not depend on the server's ordering.
        server.enqueue(
            MockResponse().setBody(
                """
                {"count":2,"passes":[
                  {"id":"bp_later","title":"Tokyo Trip","routeLabel":"Paris to Tokyo",
                   "flight":{"number":"GE900","aircraft":"B789","originCode":"CDG",
                     "originCity":"Paris","destinationCode":"HND","destinationCity":"Tokyo",
                     "gate":"K12","seat":"3C","boardingTime":"11:00","departureTime":"11:40",
                     "arrivalTime":"06:20"},
                   "passenger":{"name":"Arthur Fleck","verified":true},
                   "payment":{"currency":"USDC","amount":1240.0,"rewardsRate":2},
                   "boardingAt":"2026-09-01T09:00:00Z","departsAt":"2026-09-01T09:40:00Z",
                   "arrivesAt":"2026-09-01T21:20:00Z","status":"scheduled",
                   "minutesToBoarding":null,"progress":0},
                  {"id":"bp_sooner","title":"Paris Trip","routeLabel":"New York to Paris",
                   "flight":{"number":"GE352","aircraft":"A321","originCode":"JFK",
                     "originCity":"New York","destinationCode":"CDG","destinationCity":"Paris",
                     "gate":"34","seat":"19A","boardingTime":"10:20","departureTime":"17:20",
                     "arrivalTime":"07:30"},
                   "passenger":{"name":"Arthur Fleck","verified":true},
                   "payment":{"currency":"USDC","amount":486.2,"rewardsRate":2},
                   "boardingAt":"2026-08-22T17:00:00Z","departsAt":"2026-08-22T17:40:00Z",
                   "arrivesAt":"2026-08-23T01:00:00Z","status":"boarding_soon",
                   "minutesToBoarding":18,"progress":0}
                ]}
                """.trimIndent(),
            ),
        )

        val passes = assertIs<GuardianResult.Ok<List<BoardingPass>>>(
            FurlPayTravelRepository(client.api).boardingPasses(),
        ).value

        assertEquals(listOf("bp_sooner", "bp_later"), passes.map { it.id })

        val paris = passes.first()
        assertEquals("GE352", paris.flight.number)
        assertEquals("34", paris.flight.gate)
        assertEquals("19A", paris.flight.seat)
        assertEquals("Arthur Fleck", paris.passenger.name)
        assertTrue(paris.passenger.verified)
        assertEquals(FlightStatus.BOARDING_SOON, paris.status)
        assertEquals(18, paris.minutesToBoarding)
        assertEquals(Instant.parse("2026-08-22T17:00:00Z"), paris.boardingAt)

        assertEquals("/api/travel/boarding-passes", server.takeRequest().path)
    }

    @Test
    fun `a pass with an unparseable timeline is dropped, not rendered`() = runTest {
        // Every countdown on the screen derives from these instants. A row that
        // cannot supply them has no honest rendering, so it is dropped rather
        // than shown with a fabricated clock beside a real gate and seat.
        server.enqueue(
            MockResponse().setBody(
                """
                {"count":2,"passes":[
                  {"id":"bp_broken","title":"Paris Trip","routeLabel":"New York to Paris",
                   "flight":{"number":"GE352","aircraft":"A321","originCode":"JFK",
                     "originCity":"New York","destinationCode":"CDG","destinationCity":"Paris",
                     "gate":"34","seat":"19A","boardingTime":"10:20","departureTime":"17:20",
                     "arrivalTime":"07:30"},
                   "passenger":{"name":"Arthur Fleck","verified":true},
                   "boardingAt":"soon","departsAt":"2026-08-22T17:40:00Z",
                   "arrivesAt":"2026-08-23T01:00:00Z"},
                  {"id":"bp_ok","title":"Paris Trip","routeLabel":"New York to Paris",
                   "flight":{"number":"GE352","aircraft":"A321","originCode":"JFK",
                     "originCity":"New York","destinationCode":"CDG","destinationCity":"Paris",
                     "gate":"34","seat":"19A","boardingTime":"10:20","departureTime":"17:20",
                     "arrivalTime":"07:30"},
                   "passenger":{"name":"Arthur Fleck","verified":true},
                   "boardingAt":"2026-08-22T17:00:00Z","departsAt":"2026-08-22T17:40:00Z",
                   "arrivesAt":"2026-08-23T01:00:00Z"}
                ]}
                """.trimIndent(),
            ),
        )

        val passes = assertIs<GuardianResult.Ok<List<BoardingPass>>>(
            FurlPayTravelRepository(client.api).boardingPasses(),
        ).value

        assertEquals(listOf("bp_ok"), passes.map { it.id })
        // Absent payment block defaults rather than failing the whole parse.
        assertEquals("USDC", passes[0].payment.currency)
        assertEquals(0.0, passes[0].payment.amount)
    }

    @Test
    fun `no boarding passes is an empty list, never a placeholder`() = runTest {
        server.enqueue(MockResponse().setBody("""{"count":0,"passes":[]}"""))

        val passes = assertIs<GuardianResult.Ok<List<BoardingPass>>>(
            FurlPayTravelRepository(client.api).boardingPasses(),
        ).value

        assertTrue(passes.isEmpty())
    }

    @Test
    fun `network failure becomes Err, not an exception`() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":"boom"}"""))
        assertIs<GuardianResult.Err>(FurlPayWalletRepository(client.api).wallets())
    }

    @Test
    fun `dispatcher posts the registry-rebuilt body to the registry endpoint`() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"card":{"id":"c1","last4":"4521"}}"""))

        val resolved = GuardianActionRegistry.resolve(
            Confirmation(
                action = "card_control",
                endpoint = "/api/cards/settings", // server-style prefixed path
                body = buildJsonObject {
                    put("cardId", "c1")
                    put("freeze", true)
                    put("adminOverride", true) // must be stripped
                },
                summary = "Freeze card",
            ),
        )
        val ok = assertIs<ResolvedConfirmation.Ok>(resolved)

        assertIs<GuardianResult.Ok<kotlinx.serialization.json.JsonObject>>(
            ActionDispatcher(client.api).dispatch(ok),
        )

        val recorded = server.takeRequest()
        assertEquals("/api/cards/settings", recorded.path)
        val sent = Json.parseToJsonElement(recorded.body.readUtf8()).jsonObject
        assertEquals(setOf("cardId", "freeze"), sent.keys)
    }
}
