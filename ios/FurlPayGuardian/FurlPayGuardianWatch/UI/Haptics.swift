//
//  Haptics.swift
//
//  Port of wear/ui/Haptics.kt.
//
//  On a watch the haptic IS the confirmation. The screen is often not being
//  looked at when the tap lands — a freeze that vibrates is understood; a
//  freeze that only changes a pixel is not.
//
//  Routed through GuardianPreferences.hapticsEnabled so the user can turn it
//  off, which the Wear build also honoured.
//

import SwiftUI
import WatchKit

public enum GuardianHaptic {
    /// A destructive or money-moving action succeeded.
    case confirmed
    /// A request failed or was refused.
    case failed
    /// Lightweight tick for selection changes.
    case selection
    /// Something needs attention now — the alarm ladder uses this.
    case alert

    var wkType: WKHapticType {
        switch self {
        case .confirmed: .success
        case .failed:    .failure
        case .selection: .click
        case .alert:     .notification
        }
    }

    @MainActor
    public func play() {
        guard GuardianPreferences.shared.hapticsEnabled else { return }
        WKInterfaceDevice.current().play(wkType)
    }
}

public extension View {
    /// Fires a haptic when `trigger` changes to a non-nil / true value.
    ///
    /// A modifier rather than a call site inside each button: the Wear code
    /// vibrated from the ViewModel, which meant a screen could forget. Attaching
    /// it to the view that shows the result makes the two impossible to
    /// separate.
    func guardianHaptic<T: Equatable>(_ haptic: GuardianHaptic, on trigger: T?) -> some View {
        onChange(of: trigger) { _, newValue in
            guard newValue != nil else { return }
            haptic.play()
        }
    }
}
