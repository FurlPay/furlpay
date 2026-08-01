//
//  GuardianAlarmKit.swift
//
//  Real alarms, via AlarmKit (iOS 26).
//
//  THIS FILE RETIRES A CLAIM THIS PORT USED TO MAKE. The README and the earlier
//  AlarmScheduler said iOS could not wake the screen or draw over the lock
//  screen, so a staged notification ladder was "the ceiling". That was true
//  until iOS 26. AlarmKit gives third-party apps the same capability Apple's
//  own Clock has:
//
//    * rings through Silent mode and through an active Focus
//    * presents full-screen on the Lock Screen, in StandBy and the Dynamic
//      Island, and mirrors to a paired Apple Watch
//    * survives a reboot or an app update, which UNUserNotificationCenter
//      alarms notoriously did not
//
//  So a CRITICAL Guardian reminder now behaves the way the Android build's
//  AlarmActivity behaves, rather than approximating it.
//
//  iOS 18 and 25 devices keep the notification ladder — see AlarmScheduler.
//  The two are mutually exclusive: scheduling both would ring twice.
//

import Foundation
#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

// GuardianAlarmMetadata lives in Shared/Alarms — the Live Activity extension
// compiles the same file, and AlarmKit needs both sides to agree on the type.

@MainActor
public final class GuardianAlarmKitScheduler {

    public init() {}

    /// Whether the real-alarm path is usable at all on this device.
    ///
    /// Checked in one place so callers never have to repeat the availability
    /// dance, and so AlarmScheduler has a single question to ask before
    /// deciding which mechanism owns an event.
    public static var isSupported: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    /// Asks for alarm authorization.
    ///
    /// Separate from notification authorization on purpose: a user may well
    /// want reminders in Notification Centre without granting something that
    /// can override Silent mode, and conflating the two prompts would make the
    /// stronger permission look like a formality.
    public func requestAuthorization() async -> Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            do {
                let state = try await AlarmManager.shared.requestAuthorization()
                return state == .authorized
            } catch {
                return false
            }
        }
        #endif
        return false
    }

    public var isAuthorized: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            return AlarmManager.shared.authorizationState == .authorized
        }
        #endif
        return false
    }

    /// Schedules one alarm for an event. Returns false when AlarmKit could not
    /// take it, so the caller can fall back to the notification ladder rather
    /// than silently scheduling nothing.
    @discardableResult
    public func schedule(_ event: GuardianEvent) async -> Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            guard isAuthorized, event.startAt > Date() else { return false }

            let stop = AlarmButton(
                text: "Acknowledge",
                textColor: .white,
                systemImageName: "checkmark"
            )
            // "Snooze" is deliberately absent for CRITICAL. The Android build
            // has the same rule: the escalation ladder IS the snooze, and a
            // second deferral mechanism would let a critical reminder be
            // postponed indefinitely.
            let secondary: AlarmButton? = event.priority == .critical
                ? nil
                : AlarmButton(text: "Snooze", textColor: .white, systemImageName: "zzz")

            let alert = AlarmPresentation.Alert(
                title: LocalizedStringResource(stringLiteral: event.title),
                stopButton: stop,
                secondaryButton: secondary,
                secondaryButtonBehavior: secondary == nil ? nil : .countdown
            )

            let attributes = AlarmAttributes<GuardianAlarmMetadata>(
                presentation: AlarmPresentation(alert: alert),
                metadata: GuardianAlarmMetadata(eventId: event.id, detail: event.detail),
                tintColor: event.priority == .critical ? .red : .orange
            )

            let calendar = Calendar.current
            let parts = calendar.dateComponents([.hour, .minute], from: event.startAt)
            let schedule = Alarm.Schedule.relative(
                .init(
                    time: .init(hour: parts.hour ?? 0, minute: parts.minute ?? 0),
                    // Guardian reminders are one-shot. A repeating alarm the
                    // user cannot see in our UI would be unaccountable.
                    repeats: .never
                )
            )

            do {
                _ = try await AlarmManager.shared.schedule(
                    id: Self.alarmId(for: event.id),
                    configuration: .alarm(schedule: schedule, attributes: attributes)
                )
                return true
            } catch {
                return false
            }
        }
        #endif
        return false
    }

    public func cancel(_ eventId: String) async {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            try? AlarmManager.shared.cancel(id: Self.alarmId(for: eventId))
        }
        #endif
    }

    /// Observes alarm state so acknowledging on the Lock Screen also
    /// acknowledges in the app. Without this the two would disagree: the alarm
    /// would stop ringing while the reminder still showed as outstanding.
    public func observe(_ container: ServiceContainer) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            Task {
                for await alarms in AlarmManager.shared.alarmUpdates {
                    let live = Set(alarms.map(\.id))
                    for event in container.events.active {
                        // Gone from AlarmKit but still outstanding here means
                        // the user dealt with it on the Lock Screen.
                        if !live.contains(Self.alarmId(for: event.id)),
                           event.startAt <= Date() {
                            container.events.acknowledge(event.id)
                        }
                    }
                }
            }
        }
        #endif
    }

    /// AlarmKit keys on UUID; our events use string ids that are not always
    /// UUIDs (`reminder-<uuid>`, server ids). Derived deterministically so
    /// cancelling finds the same alarm scheduling created.
    ///
    /// `nonisolated` because it is pure and is called from the alarm-updates
    /// stream and from tests, neither of which is on the main actor.
    nonisolated static func alarmId(for eventId: String) -> UUID {
        if let direct = UUID(uuidString: eventId) { return direct }
        if let trimmed = eventId.split(separator: "-", maxSplits: 1).last,
           let embedded = UUID(uuidString: String(trimmed)) {
            return embedded
        }
        // Stable 16-byte digest of the id. Not security-sensitive — it only
        // needs to be collision-free across one user's reminders and identical
        // between the schedule and the cancel.
        var bytes = [UInt8](repeating: 0, count: 16)
        for (index, byte) in Array(eventId.utf8).enumerated() {
            bytes[index % 16] = bytes[index % 16] &+ byte &+ UInt8(index & 0xFF)
        }
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3],
                           bytes[4], bytes[5], bytes[6], bytes[7],
                           bytes[8], bytes[9], bytes[10], bytes[11],
                           bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}
