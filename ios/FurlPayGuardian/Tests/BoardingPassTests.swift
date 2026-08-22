//
//  BoardingPassTests.swift
//
//  The Trips surface has three independent implementations — the web page, the
//  Expo app and this one — reading one server payload. These tests pin the two
//  places they could silently disagree: the status ladder derived from the
//  clock, and the barcode drawn from the pass id.
//

import Testing
import Foundation
@testable import FurlPayGuardian

private let t0 = Date(timeIntervalSince1970: 1_787_000_000)
private let minute: TimeInterval = 60

private func makePass(
    boardingIn: TimeInterval = 18 * minute,
    departsIn: TimeInterval = 58 * minute,
    arrivesIn: TimeInterval = 500 * minute
) -> BoardingPass {
    BoardingPass(
        id: "bp_demo_cdg_u1",
        title: "Paris Trip",
        routeLabel: "New York → Paris",
        flight: BoardingPassFlight(
            number: "GE352",
            aircraft: "A321",
            originCode: "JFK",
            originCity: "New York",
            destinationCode: "CDG",
            destinationCity: "Paris",
            gate: "34",
            seat: "19A",
            boardingTime: "10:20",
            departureTime: "17:20",
            arrivalTime: "07:30"
        ),
        passenger: BoardingPassPassenger(name: "Ada Lovelace", verified: true),
        payment: BoardingPassPayment(currency: "USDC", amount: 486.20, rewardsRate: 2),
        boardingAt: t0.addingTimeInterval(boardingIn),
        departsAt: t0.addingTimeInterval(departsIn),
        arrivesAt: t0.addingTimeInterval(arrivesIn),
        status: .boardingSoon,
        minutesToBoarding: 18,
        progress: 0
    )
}

@Suite("Boarding pass status")
struct BoardingPassStatusTests {

    @Test("walks the ladder as the clock advances")
    func ladder() {
        let pass = makePass()
        #expect(pass.status(at: t0.addingTimeInterval(-20 * minute)) == .scheduled)
        #expect(pass.status(at: t0) == .boardingSoon)
        #expect(pass.status(at: t0.addingTimeInterval(19 * minute)) == .boarding)
        #expect(pass.status(at: t0.addingTimeInterval(59 * minute)) == .departed)
        #expect(pass.status(at: t0.addingTimeInterval(501 * minute)) == .landed)
    }

    @Test("agrees with the status the server sent, at the instant it sent it")
    func agreesWithServer() {
        // The screen recomputes status so a view left open cannot keep claiming
        // "boarding". If the two ladders differed, every refetch would flicker.
        #expect(makePass().status(at: t0) == makePass().status)
    }

    @Test("counts down and stops at boarding rather than going negative")
    func countdown() {
        let pass = makePass()
        #expect(pass.minutesToBoarding(at: t0) == 18)
        #expect(pass.minutesToBoarding(at: t0.addingTimeInterval(17 * minute)) == 1)
        #expect(pass.minutesToBoarding(at: t0.addingTimeInterval(18 * minute)) == nil)
        #expect(pass.minutesToBoarding(at: t0.addingTimeInterval(90 * minute)) == nil)
    }

    @Test("never renders a negative countdown at any point in the trip")
    func noNegatives() {
        let pass = makePass()
        for m in stride(from: 0.0, through: 600.0, by: 7.0) {
            let line = pass.statusLine(at: t0.addingTimeInterval(m * minute))
            #expect(!line.contains("-"), "negative countdown at +\(m)m: \(line)")
        }
    }

    @Test("status line reads as the design does, then names the gate")
    func statusLine() {
        let pass = makePass()
        #expect(pass.statusLine(at: t0) == "Boarding in 18 min")
        #expect(pass.statusLine(at: t0.addingTimeInterval(20 * minute)) == "Boarding · Gate 34")
        #expect(pass.statusLine(at: t0.addingTimeInterval(90 * minute)) == "In the air · lands 07:30")
        #expect(pass.statusLine(at: t0.addingTimeInterval(600 * minute)) == "Landed 07:30")
    }

    @Test("route progress stays at zero until the aircraft actually departs")
    func progressHoldsAtGate() {
        let pass = makePass()
        #expect(pass.routeProgress(at: t0) == 0)
        #expect(pass.routeProgress(at: t0.addingTimeInterval(57 * minute)) == 0)
        #expect(pass.routeProgress(at: t0.addingTimeInterval(58 * minute)) == 0)
    }

    @Test("route progress runs 0 to 1 and never overshoots")
    func progressRange() {
        let pass = makePass()
        let half = (58.0 + 500.0) / 2
        #expect(abs(pass.routeProgress(at: t0.addingTimeInterval(half * minute)) - 0.5) < 0.01)
        #expect(pass.routeProgress(at: t0.addingTimeInterval(500 * minute)) == 1)
        #expect(pass.routeProgress(at: t0.addingTimeInterval(900 * minute)) == 1)
    }

    @Test("every status has a label for the detail card")
    func labels() {
        for status in FlightStatus.allCases {
            #expect(!status.label.isEmpty)
        }
    }

    @Test("decodes the server's snake_case status wire format")
    func decodesWireFormat() throws {
        // The server sends "boarding_soon". A mismatch here would fail the whole
        // pass decode and show "No flight booked" to someone holding a ticket.
        #expect(FlightStatus(rawValue: "boarding_soon") == .boardingSoon)
        #expect(FlightStatus(rawValue: "boarding") == .boarding)
        #expect(FlightStatus(rawValue: "landed") == .landed)
    }
}

@Suite("Boarding pass barcode")
struct BoardingPassBarcodeTests {

    @Test("is deterministic for a value")
    func deterministic() {
        #expect(boardingPassBars("bp_a") == boardingPassBars("bp_a"))
    }

    @Test("differs across values")
    func differs() {
        #expect(boardingPassBars("bp_a") != boardingPassBars("bp_b"))
    }

    @Test("emits only widths the renderer can draw")
    func widths() {
        for width in boardingPassBars("bp_demo_cdg_u1") {
            #expect(width >= 1)
            #expect(width <= 4)
        }
    }

    @Test("keeps the bar count the other two clients use")
    func barCount() {
        // 4 leading guard + 108 body + 4 trailing. The web and Expo apps assert
        // the same number; a change on one side without the others would draw a
        // different pass for the same booking.
        #expect(boardingPassBars("x").count == 116)
    }

    @Test("matches the reference pattern the web and Expo clients produce")
    func crossClientParity() {
        // First eight bars for "GE352", captured from the TypeScript
        // implementation. FNV-1a then an LCG — identical arithmetic, so any
        // drift in the Swift port shows up right here.
        let expected = [3, 2, 1, 3, 2, 1, 2, 3]
        #expect(Array(boardingPassBars("GE352").prefix(8)) == expected)
    }
}

@Suite("Flight deep link")
struct FlightDeepLinkTests {

    @Test("the Live Activity's widgetURL resolves to the boarding pass")
    func widgetURL() throws {
        let url = try #require(URL(string: "furlpay://boarding-pass"))
        #expect(GuardianDeepLink(url: url) == .boardingPass)
    }

    @Test("an unknown host does not resolve, so nothing else can drive navigation")
    func unknownHost() throws {
        let url = try #require(URL(string: "furlpay://not-a-screen"))
        #expect(GuardianDeepLink(url: url) == nil)
    }

    @Test("a foreign scheme is refused outright")
    func foreignScheme() throws {
        let url = try #require(URL(string: "https://boarding-pass"))
        #expect(GuardianDeepLink(url: url) == nil)
    }

    @Test("a gate-change push routes to the pass, not the travel index")
    func pushPayload() {
        #expect(GuardianDeepLink(payload: ["link": "boardingPass"]) == .boardingPass)
        #expect(GuardianDeepLink(payload: ["link": "boarding-pass"]) == .boardingPass)
    }
}
