//
//  FlightActivityAttributes.swift
//
//  The contract between the app (which starts and updates the Live Activity)
//  and the widget extension (which draws it). It lives in Shared/Models because
//  that directory is compiled into BOTH targets — an ActivityAttributes type
//  declared in only one of them cannot be matched up at runtime, and the
//  activity simply never appears.
//
//  WHAT IS IN ContentState AND WHAT IS NOT
//
//  ContentState is the part that changes. Gate, seat, flight number and route
//  never change for a given pass, so they are static attributes: putting them
//  in the state would push identical bytes on every refresh and eat the
//  budget ActivityKit gives us for updates that matter.
//
//  `boardingAt` is carried as a Date, not as a pre-rendered "18 min". That is
//  what lets the Lock Screen render a self-updating `Text(timerInterval:)` —
//  the countdown then ticks with no process running, no push, and no chance of
//  going stale while the phone is in a pocket.
//

import Foundation

// `os(iOS)` as well as `canImport`: Shared/Models is compiled into the watchOS
// complications target too, and ActivityKit is importable there on recent
// watchOS without `ActivityAttributes` being available to a watch extension.
// Gating on the platform keeps this type out of that build entirely.
#if os(iOS) && canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
public struct FlightActivityAttributes: ActivityAttributes, Sendable {
    public struct ContentState: Codable, Hashable, Sendable {
        /// Live status. Drives the glyph and the accent.
        public let status: FlightStatus
        /// When boarding starts. The countdown is rendered FROM this by SwiftUI.
        public let boardingAt: Date
        /// Gate can and does change after the pass is issued — the one mutable
        /// "static-looking" fact, and the reason a passenger looks at all.
        public let gate: String
        /// 0–1 along the route; 0 until the aircraft departs.
        public let progress: Double

        public init(status: FlightStatus, boardingAt: Date, gate: String, progress: Double) {
            self.status = status
            self.boardingAt = boardingAt
            self.gate = gate
            self.progress = progress
        }
    }

    public let passId: String
    public let flightNumber: String
    public let originCode: String
    public let destinationCode: String
    public let seat: String
    public let departsAt: Date
    public let arrivalTime: String

    public init(
        passId: String,
        flightNumber: String,
        originCode: String,
        destinationCode: String,
        seat: String,
        departsAt: Date,
        arrivalTime: String
    ) {
        self.passId = passId
        self.flightNumber = flightNumber
        self.originCode = originCode
        self.destinationCode = destinationCode
        self.seat = seat
        self.departsAt = departsAt
        self.arrivalTime = arrivalTime
    }
}

@available(iOS 16.1, *)
public extension FlightActivityAttributes {
    /// Build the immutable half from a pass.
    init(pass: BoardingPass) {
        self.init(
            passId: pass.id,
            flightNumber: pass.flight.number,
            originCode: pass.flight.originCode,
            destinationCode: pass.flight.destinationCode,
            seat: pass.flight.seat,
            departsAt: pass.departsAt,
            arrivalTime: pass.flight.arrivalTime
        )
    }
}

@available(iOS 16.1, *)
public extension FlightActivityAttributes.ContentState {
    /// Build the mutable half from a pass, as of `now`.
    init(pass: BoardingPass, at now: Date = .now) {
        self.init(
            status: pass.status(at: now),
            boardingAt: pass.boardingAt,
            gate: pass.flight.gate,
            progress: pass.routeProgress(at: now)
        )
    }
}
#endif
