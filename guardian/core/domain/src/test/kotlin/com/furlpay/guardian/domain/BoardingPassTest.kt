package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.model.BoardingPass
import com.furlpay.guardian.domain.model.BoardingPassFlight
import com.furlpay.guardian.domain.model.BoardingPassPassenger
import com.furlpay.guardian.domain.model.BoardingPassPayment
import com.furlpay.guardian.domain.model.FlightStatus
import com.furlpay.guardian.domain.model.minutesToBoardingAt
import com.furlpay.guardian.domain.model.routeProgressAt
import com.furlpay.guardian.domain.model.statusAt
import com.furlpay.guardian.domain.model.statusLine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlinx.datetime.Instant

/**
 * The status ladder and the countdown are the two things a passenger acts on,
 * and they are re-derived on every render rather than trusted from the payload.
 * These pin the same boundaries apps/web/src/lib/travel/boardingPass.ts and the
 * SwiftUI port enforce, so the three cannot drift apart silently.
 */
class BoardingPassTest {

    private val boarding = Instant.parse("2026-08-22T17:00:00Z")
    private val departs = Instant.parse("2026-08-22T17:40:00Z")
    private val arrives = Instant.parse("2026-08-23T01:00:00Z")

    private val pass = BoardingPass(
        id = "bp_demo_cdg_u_123",
        title = "Paris Trip",
        routeLabel = "New York to Paris",
        flight = BoardingPassFlight(
            number = "GE352",
            aircraft = "A321",
            originCode = "JFK",
            originCity = "New York",
            destinationCode = "CDG",
            destinationCity = "Paris",
            gate = "34",
            seat = "19A",
            boardingTime = "10:20",
            departureTime = "17:20",
            arrivalTime = "07:30",
        ),
        passenger = BoardingPassPassenger("Arthur Fleck", verified = true),
        payment = BoardingPassPayment("USDC", 486.2, 2.0),
        boardingAt = boarding,
        departsAt = departs,
        arrivesAt = arrives,
        status = FlightStatus.BOARDING_SOON,
        minutesToBoarding = 18,
        progress = 0.0,
    )

    @Test
    fun `status walks the ladder from the clock, not from the payload`() {
        assertEquals(FlightStatus.SCHEDULED, pass.statusAt(Instant.parse("2026-08-22T12:00:00Z")))
        assertEquals(FlightStatus.BOARDING_SOON, pass.statusAt(Instant.parse("2026-08-22T16:42:00Z")))
        assertEquals(FlightStatus.BOARDING, pass.statusAt(Instant.parse("2026-08-22T17:10:00Z")))
        assertEquals(FlightStatus.DEPARTED, pass.statusAt(Instant.parse("2026-08-22T19:00:00Z")))
        assertEquals(FlightStatus.LANDED, pass.statusAt(Instant.parse("2026-08-23T02:00:00Z")))
    }

    @Test
    fun `the boarding-soon window opens exactly 30 minutes out, not a second earlier`() {
        // 30m00s before boarding is inside the window; 30m01s is not. Comparing
        // in whole minutes would round the second case down to 30 and flip the
        // pass early, disagreeing with web and iOS.
        assertEquals(FlightStatus.BOARDING_SOON, pass.statusAt(boarding - 30.minutes))
        assertEquals(FlightStatus.SCHEDULED, pass.statusAt(boarding - 30.minutes - 1.seconds))
    }

    @Test
    fun `boundaries are inclusive of the later state`() {
        assertEquals(FlightStatus.BOARDING, pass.statusAt(boarding))
        assertEquals(FlightStatus.DEPARTED, pass.statusAt(departs))
        assertEquals(FlightStatus.LANDED, pass.statusAt(arrives))
    }

    @Test
    fun `minutes to boarding round and then stop`() {
        assertEquals(18, pass.minutesToBoardingAt(Instant.parse("2026-08-22T16:42:00Z")))
        assertEquals(1, pass.minutesToBoardingAt(Instant.parse("2026-08-22T16:59:30Z")))
        assertNull(pass.minutesToBoardingAt(boarding), "boarding has started")
        assertNull(pass.minutesToBoardingAt(Instant.parse("2026-08-22T18:00:00Z")))
    }

    @Test
    fun `progress stays at zero until the aircraft actually departs`() {
        // A line that creeps while the plane is still at the gate is a
        // fabricated signal, however good it looks.
        assertEquals(0.0, pass.routeProgressAt(Instant.parse("2026-08-22T17:00:00Z")))
        assertEquals(0.0, pass.routeProgressAt(departs))
        assertEquals(0.5, pass.routeProgressAt(Instant.parse("2026-08-22T21:20:00Z")), 0.001)
        assertEquals(1.0, pass.routeProgressAt(Instant.parse("2026-08-23T05:00:00Z")), 0.001)
    }

    @Test
    fun `status line says what the passenger has to do next`() {
        assertEquals("Boarding in 18 min", pass.statusLine(Instant.parse("2026-08-22T16:42:00Z")))
        assertEquals("Boarding - Gate 34", pass.statusLine(Instant.parse("2026-08-22T17:10:00Z")))
        assertEquals("In the air - lands 07:30", pass.statusLine(Instant.parse("2026-08-22T19:00:00Z")))
        assertEquals("Landed 07:30", pass.statusLine(Instant.parse("2026-08-23T02:00:00Z")))
    }

    @Test
    fun `a zero-length flight cannot divide by zero`() {
        val instant = pass.copy(arrivesAt = departs)
        assertEquals(0.0, instant.routeProgressAt(Instant.parse("2026-08-22T19:00:00Z")))
    }

    @Test
    fun `unknown wire status degrades to scheduled instead of throwing`() {
        assertEquals(FlightStatus.SCHEDULED, FlightStatus.fromWire("diverted"))
        assertEquals(FlightStatus.SCHEDULED, FlightStatus.fromWire(null))
        assertEquals(FlightStatus.BOARDING_SOON, FlightStatus.fromWire("boarding_soon"))
    }
}
