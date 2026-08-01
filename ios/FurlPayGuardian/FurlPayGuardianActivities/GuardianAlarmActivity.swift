//
//  GuardianAlarmActivity.swift
//
//  The Live Activity AlarmKit renders. Without an ActivityConfiguration for
//  AlarmAttributes, a scheduled alarm has nothing to draw on the Lock Screen or
//  in the Dynamic Island — AlarmKit requires the widget extension to supply it.
//
//  This is the iOS answer to Android's AlarmActivity. Note what it does NOT do:
//  it never fetches, never reads the token, and shows only what AlarmKit hands
//  it. An alarm surface that could block on a network call would be the one
//  place a spinner is genuinely unacceptable.
//

#if canImport(AlarmKit)
import AlarmKit
import WidgetKit
import SwiftUI

@available(iOS 26.0, *)
struct GuardianAlarmActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<GuardianAlarmMetadata>.self) { context in
            // Lock Screen / StandBy presentation.
            GuardianAlarmLockScreenView(attributes: context.attributes)
                .padding()
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "bell.badge.fill")
                        .foregroundStyle(context.attributes.tintColor)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.presentation.alert.title)
                        .font(.headline)
                        .lineLimit(2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let detail = context.attributes.metadata?.detail {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                Image(systemName: "bell.fill")
                    .foregroundStyle(context.attributes.tintColor)
            } compactTrailing: {
                Image(systemName: "exclamationmark")
                    .foregroundStyle(context.attributes.tintColor)
            } minimal: {
                Image(systemName: "bell.fill")
                    .foregroundStyle(context.attributes.tintColor)
            }
        }
    }
}

@available(iOS 26.0, *)
struct GuardianAlarmLockScreenView: View {
    let attributes: AlarmAttributes<GuardianAlarmMetadata>

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "bell.badge.fill")
                .font(.title)
                .foregroundStyle(attributes.tintColor)

            VStack(alignment: .leading, spacing: 2) {
                Text(attributes.presentation.alert.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(2)

                if let detail = attributes.metadata?.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                } else {
                    Text("FurlPay Guardian")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
            Spacer(minLength: 0)
        }
    }
}
#endif
