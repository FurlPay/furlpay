//
//  AlarmScheduler.swift
//
//  Port of guardian GuardianAlarmScheduler (AlarmManager.setExactAndAllowWhileIdle
//  plus staged escalation) onto UNUserNotificationCenter.
//
//  TWO MECHANISMS, CHOSEN PER DEVICE:
//
//   * iOS 26+ → AlarmKit. A real alarm: rings through Silent and Focus,
//     full-screen on the Lock Screen, survives reboot. See GuardianAlarmKit.
//   * iOS 18–25 → the staged notification ladder below. Increasing interruption
//     levels, and `.critical` only if Apple granted the entitlement.
//
//  Exactly ONE of them owns any given event. Scheduling both would ring twice,
//  which is worse than either alone.
//
//  The ladder is not dead code: it is what the current installed base runs on,
//  and it is the fallback when the user grants notifications but declines the
//  stronger alarm permission.
//

import Foundation
import UserNotifications

@MainActor
public final class AlarmScheduler {

    /// The `userInfo` key carrying the event id. Read by
    /// PushNotificationService to tell a rung alarm from a server push — a
    /// literal on both sides would drift silently and alarms would route as
    /// ordinary notifications.
    public static let eventIdKey = "eventId"

    private let alarmKit = GuardianAlarmKitScheduler()

    public init() {}

    /// True once AlarmKit has been authorised — the app is then using real
    /// alarms and the ladder is dormant. Surfaced so Settings can tell the user
    /// which one they are actually getting.
    public var usingRealAlarms: Bool {
        GuardianAlarmKitScheduler.isSupported && alarmKit.isAuthorized
    }

    /// Asks for alarm permission on devices that can grant it. Safe to call on
    /// older ones, where it is a no-op and the ladder stays in charge.
    @discardableResult
    public func requestAlarmAuthorization() async -> Bool {
        guard GuardianAlarmKitScheduler.isSupported else { return false }
        return await alarmKit.requestAuthorization()
    }

    /// Schedules the full staged escalation for one event.
    ///
    /// Android fires stages relative to the event; the same shape is kept so a
    /// reminder behaves identically on both platforms.
    public func schedule(_ event: GuardianEvent, stages: [ReminderStage] = ReminderStage.defaultLadder) async {
        await cancel(event.id)   // rescheduling must not double-fire

        // Prefer the real alarm. Returns false if AlarmKit refused (not
        // authorised, event in the past), in which case we fall through to the
        // ladder rather than scheduling nothing at all.
        if await alarmKit.schedule(event) { return }

        for (index, stage) in stages.enumerated() {
            let fireDate = event.startAt.addingTimeInterval(stage.offset)
            guard fireDate > Date() else { continue }   // never schedule the past

            let content = UNMutableNotificationContent()
            content.title = event.title
            content.body = event.detail ?? Self.body(for: stage.intensity)
            content.userInfo = [Self.eventIdKey: event.id, "stage": index]
            content.interruptionLevel = Self.interruptionLevel(
                for: stage.intensity, bypassDnd: stage.bypassDnd
            )
            content.sound = stage.bypassDnd
                ? .defaultCritical      // ignored without the entitlement
                : .default

            // A thread identifier groups the ladder into one stack in Notification
            // Centre rather than four separate rows for the same reminder.
            content.threadIdentifier = event.id

            let interval = max(1, fireDate.timeIntervalSinceNow)
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)

            let request = UNNotificationRequest(
                identifier: Self.requestId(event.id, stage: index),
                content: content,
                trigger: trigger
            )
            try? await UNUserNotificationCenter.current().add(request)
        }
    }

    public func cancel(_ eventId: String) async {
        // Cancel BOTH unconditionally. An event may have been scheduled under
        // one mechanism and cancelled after the user changed permissions, and a
        // surviving alarm nobody can see would be the worst possible bug here.
        await alarmKit.cancel(eventId)

        let centre = UNUserNotificationCenter.current()
        let pending = await centre.pendingNotificationRequests()
        let ids = pending
            .map(\.identifier)
            .filter { $0.hasPrefix("\(eventId)#") }
        centre.removePendingNotificationRequests(withIdentifiers: ids)
    }

    public func cancelAll() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    // MARK: Helpers

    private static func requestId(_ eventId: String, stage: Int) -> String {
        "\(eventId)#\(stage)"
    }

    private static func interruptionLevel(
        for intensity: ReminderIntensity, bypassDnd: Bool
    ) -> UNNotificationInterruptionLevel {
        // .critical pierces Do Not Disturb AND the ringer switch, and is the
        // only level Apple gates behind a granted entitlement. Requesting it
        // without approval degrades to .timeSensitive rather than failing.
        if bypassDnd { return .critical }
        return switch intensity {
        case .gentle: .passive
        case .firm: .active
        case .urgent, .max: .timeSensitive
        }
    }

    private static func body(for intensity: ReminderIntensity) -> String {
        switch intensity {
        case .gentle: "A reminder from Guardian."
        case .firm: "This needs your attention."
        case .urgent: "This is overdue."
        case .max: "This is overdue and escalating."
        }
    }
}

public extension ReminderStage {
    /// The default escalation ladder, matching the Android stages: a nudge
    /// before, one at the moment, then two escalating chases afterwards.
    static let defaultLadder: [ReminderStage] = [
        ReminderStage(offset: -15 * 60, intensity: .gentle, bypassDnd: false),
        ReminderStage(offset: 0, intensity: .firm, bypassDnd: false),
        ReminderStage(offset: 10 * 60, intensity: .urgent, bypassDnd: false),
        ReminderStage(offset: 30 * 60, intensity: .max, bypassDnd: true),
    ]
}
