//
//  FlightActivityController.swift
//
//  Starts, updates and ends the flight Live Activity.
//
//  Every guard in here exists because the failure it prevents is silent.
//  ActivityKit does not throw when Live Activities are switched off in
//  Settings, when eight activities are already running, or when the pass being
//  tracked has already landed — it just declines, and a UI that assumed success
//  shows a lit "Tracking" toggle with nothing on the Lock Screen.
//
//  So the controller owns the truth: `isTracking` is derived from the activity
//  list ActivityKit actually reports, never from what we asked for.
//

import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

@MainActor
@Observable
public final class FlightActivityController {

    /// Why tracking is unavailable, when it is. Surfaced verbatim to the user —
    /// "couldn't start" with no reason is the thing this avoids.
    public enum Unavailable: Equatable {
        case unsupportedOS
        case disabledInSettings
        case flightOver

        public var message: String {
            switch self {
            case .unsupportedOS:
                "Live Activities need iOS 16.2 or later."
            case .disabledInSettings:
                "Turn on Live Activities for FurlPay in Settings to see this on your Lock Screen."
            case .flightOver:
                "This flight has already landed."
            }
        }
    }

    public private(set) var trackedPassId: String?
    public private(set) var lastError: String?

    public init() {}

    /// Whether a Lock Screen activity is currently live for `pass`.
    public func isTracking(_ pass: BoardingPass) -> Bool {
        trackedPassId == pass.id
    }

    /// Nil when tracking is possible; otherwise the reason it is not.
    public func unavailableReason(for pass: BoardingPass, now: Date = .now) -> Unavailable? {
        guard pass.status(at: now) != .landed else { return .flightOver }
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return .unsupportedOS }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return .disabledInSettings }
        return nil
        #else
        return .unsupportedOS
        #endif
    }

    /// Re-read what ActivityKit actually has running. Called on appear so a
    /// toggle reflects the system after a relaunch, not our own memory of it.
    public func refresh() {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        trackedPassId = Activity<FlightActivityAttributes>.activities.first?.attributes.passId
        #endif
    }

    /// Request the activity. Returns false and sets `lastError` when it could
    /// not be started, so the caller never has to guess.
    @discardableResult
    public func start(_ pass: BoardingPass, now: Date = .now) -> Bool {
        lastError = nil
        if let reason = unavailableReason(for: pass, now: now) {
            lastError = reason.message
            return false
        }

        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return false }
        // One activity per pass. Requesting a second for the same flight would
        // stack two identical cards on the Lock Screen.
        if trackedPassId == pass.id { return true }
        endAll()

        do {
            let activity = try Activity.request(
                attributes: FlightActivityAttributes(pass: pass),
                content: .init(
                    state: .init(pass: pass, at: now),
                    // Dismiss itself shortly after the flight lands, so a stale
                    // pass cannot outlive the trip on someone's Lock Screen.
                    staleDate: pass.arrivesAt.addingTimeInterval(15 * 60)
                )
            )
            trackedPassId = activity.attributes.passId
            return true
        } catch {
            lastError = "Couldn't start the Live Activity: \(error.localizedDescription)"
            return false
        }
        #else
        return false
        #endif
    }

    /// Push the current state. Cheap and safe to call after every refetch — the
    /// gate is the field most likely to have changed under the passenger.
    public func update(_ pass: BoardingPass, now: Date = .now) async {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        // A loop, not `.first(where:)`: a closure formed here is main-actor
        // isolated, so the Activity it returns joins the actor's region and
        // Swift 6 refuses to send it into the nonisolated `update`. The loop
        // variable stays disconnected, the same way `stop()` uses it.
        for activity in Activity<FlightActivityAttributes>.activities {
            guard activity.attributes.passId == pass.id else { continue }
            await activity.update(
                ActivityContent(
                    state: .init(pass: pass, at: now),
                    staleDate: pass.arrivesAt.addingTimeInterval(15 * 60)
                )
            )
            return
        }
        #endif
    }

    /// Stop tracking. `.immediate` because the user asked — leaving the card up
    /// for four hours after an explicit "stop" is not a dismissal policy.
    public func stop() async {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        for activity in Activity<FlightActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        #endif
        trackedPassId = nil
    }

    private func endAll() {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        // Snapshot NOW, before start() requests the replacement: a task that
        // read the list later would end the new activity too. Detached, because
        // a Task inheriting @MainActor would pull the activities into the
        // actor's region and then send them back out to `end`.
        let running = Activity<FlightActivityAttributes>.activities
        Task.detached {
            for activity in running {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        #endif
        trackedPassId = nil
    }
}
