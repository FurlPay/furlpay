//
//  GuardianAlarmMetadata.swift
//
//  Shared between the app (which schedules alarms) and the Live Activity
//  extension (which renders them). AlarmKit serialises this across the process
//  boundary, so both sides must compile the SAME type — two structurally
//  identical copies in two targets would not decode.
//

#if canImport(AlarmKit)
import AlarmKit

/// Carried on the alarm so the Lock Screen presentation can show the reminder
/// rather than a placeholder, and so acknowledging there can be matched back to
/// the event that scheduled it.
///
/// Deliberately tiny: this crosses into a widget process and is visible on a
/// locked screen. It holds an id and a short detail line — never an amount,
/// never a balance, never anything that would leak a figure to a shoulder.
nonisolated struct GuardianAlarmMetadata: AlarmMetadata {
    let eventId: String
    let detail: String?

    init(eventId: String, detail: String? = nil) {
        self.eventId = eventId
        self.detail = detail
    }
}
#endif
