//
//  BoardingPass.swift
//
//  Port of apps/web/src/lib/travel/boardingPass.ts and native-app/lib/boardingPass.ts.
//
//  Deliberately NOT folded into the existing `TravelBooking` / `FlightSegment`
//  in GuardianModels.swift. Those model a booking as the trips list needs it:
//  a destination, a window, a status. A boarding pass is the gate-side document
//  — seat, gate, passenger name, a scannable id — and widening one type to
//  carry both would give every hotel stay a nil seat and every flight a nil
//  check-out date.
//
//  The derived numbers arrive from the server (minutesToBoarding, progress) AND
//  can be recomputed locally from the absolute instants. Both exist on purpose:
//  the server's copy is what the list renders on arrival, and the local
//  recomputation is what keeps a screen — or a Live Activity — honest after it
//  has been open for twenty minutes.
//

import Foundation

/// Where the flight is in its own timeline. The server owns this; the client
/// recomputes the same ladder from the same instants rather than inventing one.
public enum FlightStatus: String, Codable, Sendable, CaseIterable {
    case scheduled
    case boardingSoon = "boarding_soon"
    case boarding
    case departed
    case landed

    /// The longer label the detail card shows under "Status".
    public var label: String {
        switch self {
        case .scheduled:    "Scheduled"
        case .boardingSoon: "Boarding Soon"
        case .boarding:     "Boarding"
        case .departed:     "In the Air"
        case .landed:       "Landed"
        }
    }
}

/// The flight as printed on the pass. Times are the airport's own local
/// wall-clock, formatted by the server — a client that re-derived them from the
/// instants would need every airport's timezone to get the arrival right.
public struct BoardingPassFlight: Codable, Sendable, Hashable {
    public let number: String
    public let aircraft: String
    public let originCode: String
    public let originCity: String
    public let destinationCode: String
    public let destinationCity: String
    public let gate: String
    public let seat: String
    public let boardingTime: String
    public let departureTime: String
    public let arrivalTime: String
}

public struct BoardingPassPassenger: Codable, Sendable, Hashable {
    public let name: String
    public let verified: Bool
}

public struct BoardingPassPayment: Codable, Sendable, Hashable {
    public let currency: String
    public let amount: Double
    public let rewardsRate: Double
}

public struct BoardingPass: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let title: String
    public let routeLabel: String
    public let flight: BoardingPassFlight
    public let passenger: BoardingPassPassenger
    public let payment: BoardingPassPayment
    public let boardingAt: Date
    public let departsAt: Date
    public let arrivesAt: Date
    /// The status at the instant the payload was built. Prefer `status(at:)`.
    public let status: FlightStatus
    public let minutesToBoarding: Int?
    public let progress: Double
}

// MARK: - Live derivation

public extension BoardingPass {
    private static let boardingSoonWindow: TimeInterval = 30 * 60

    /// Recomputed from the clock, so a screen left open cannot keep claiming
    /// "boarding" for a flight that left an hour ago.
    func status(at now: Date = .now) -> FlightStatus {
        if now >= arrivesAt { return .landed }
        if now >= departsAt { return .departed }
        if now >= boardingAt { return .boarding }
        if now >= boardingAt.addingTimeInterval(-Self.boardingSoonWindow) { return .boardingSoon }
        return .scheduled
    }

    /// Minutes until boarding, or nil once boarding has begun.
    func minutesToBoarding(at now: Date = .now) -> Int? {
        let delta = boardingAt.timeIntervalSince(now)
        guard delta > 0 else { return nil }
        return max(0, Int((delta / 60).rounded()))
    }

    /// 0–1 along the route. Zero until the aircraft actually departs — a
    /// progress line that creeps while the plane is still at the gate is a
    /// fabricated signal, however good it looks.
    func routeProgress(at now: Date = .now) -> Double {
        guard now > departsAt, arrivesAt > departsAt else { return 0 }
        let flown = now.timeIntervalSince(departsAt) / arrivesAt.timeIntervalSince(departsAt)
        return min(1, max(0, flown))
    }

    /// The one-line status the Live Activity and the compact card show.
    func statusLine(at now: Date = .now) -> String {
        switch status(at: now) {
        case .scheduled, .boardingSoon:
            guard let minutes = minutesToBoarding(at: now) else { return "Boarding now" }
            return "Boarding in \(minutes) min"
        case .boarding:
            return "Boarding · Gate \(flight.gate)"
        case .departed:
            return "In the air · lands \(flight.arrivalTime)"
        case .landed:
            return "Landed \(flight.arrivalTime)"
        }
    }

    /// Route line for accessibility and share sheets.
    var routeSummary: String {
        "\(flight.originCode) to \(flight.destinationCode)"
    }
}
