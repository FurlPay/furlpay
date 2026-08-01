//
//  GuardianActivitiesBundle.swift
//
//  iOS widget extension. Its only job today is hosting the AlarmKit Live
//  Activity — AlarmKit will not present an alarm without one.
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
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            GuardianAlarmActivity()
        }
        #endif
    }
}
