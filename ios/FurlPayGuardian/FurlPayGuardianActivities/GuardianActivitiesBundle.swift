//
//  GuardianActivitiesBundle.swift
//
//  iOS widget extension. It hosts the two Live Activities: the AlarmKit one
//  (which AlarmKit will not present without an ActivityConfiguration) and the
//  flight one behind the Trips screen.
//
//  Separate from FurlPayGuardianWidgets because that target is watchOS. A
//  single extension cannot serve both platforms, and the watch complications
//  have no business linking AlarmKit.
//

import WidgetKit
import SwiftUI

@main
struct GuardianActivitiesBundle: WidgetBundle {
    var body: some Widget {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            FlightLiveActivity()
        }
        #endif
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            GuardianAlarmActivity()
        }
        #endif
    }
}
