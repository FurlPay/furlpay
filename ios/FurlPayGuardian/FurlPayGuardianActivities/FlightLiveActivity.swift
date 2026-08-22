//
//  FlightLiveActivity.swift
//
//  The Live Activity from the FurlPay Trips design, for real: Lock Screen,
//  StandBy, and all three Dynamic Island presentations.
//
//  THE COUNTDOWN IS NOT A STRING. Every time shown here is rendered by SwiftUI
//  from a Date with `Text(timerInterval:)` or `Text(_:style:)`. A Live Activity
//  gets a small budget of updates and may sit untouched on a Lock Screen for an
//  hour; a pre-formatted "Boarding in 18 min" pushed at 09:00 still says 18
//  minutes at 09:40. Handing SwiftUI the instant makes the number correct with
//  no process running, no push, and no battery cost.
//
//  Nothing in this file fetches, and nothing reads the token. The extension is
//  handed a state by the app and draws exactly that.
//

#if canImport(ActivityKit)
import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.2, *)
struct FlightLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FlightActivityAttributes.self) { context in
            FlightLockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color(red: 0.016, green: 0.063, blue: 0.043))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.originCode)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.white)
                        Text("Gate \(context.state.gate)")
                            .font(.caption2)
                            .foregroundStyle(TripsPalette.subText)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(context.attributes.destinationCode)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.white)
                        Text("Seat \(context.attributes.seat)")
                            .font(.caption2)
                            .foregroundStyle(TripsPalette.subText)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    RouteTrack(progress: context.state.progress)
                        .frame(height: 16)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.attributes.flightNumber)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.white.opacity(0.9))
                        Spacer()
                        StatusText(state: context.state, arrivalTime: context.attributes.arrivalTime)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(TripsPalette.green)
                    }
                }
            } compactLeading: {
                FurlPayMark(size: 16)
            } compactTrailing: {
                // The compact trailing slot is roughly four characters wide, so
                // it gets the single most useful number and nothing else.
                CompactCountdown(state: context.state)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(TripsPalette.green)
            } minimal: {
                FurlPayMark(size: 16)
            }
            .keylineTint(TripsPalette.green)
            .widgetURL(URL(string: "furlpay://boarding-pass"))
        }
    }
}

// MARK: - Lock Screen

@available(iOS 16.2, *)
struct FlightLockScreenView: View {
    let attributes: FlightActivityAttributes
    let state: FlightActivityAttributes.ContentState

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            FurlPayMark(size: 33)
                .padding(.top, 15)

            VStack(alignment: .leading, spacing: 6) {
                Text("FurlPay")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(TripsPalette.greenDim)

                HStack(spacing: 6) {
                    Text(attributes.originCode)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 15, weight: .bold))
                    Text(attributes.destinationCode)
                }
                .font(.title2.weight(.bold))
                .foregroundStyle(.white)

                Text(attributes.flightNumber)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.9))

                StatusText(state: state, arrivalTime: attributes.arrivalTime)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(TripsPalette.green)
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 8) {
                RouteTrack(progress: state.progress)
                    .frame(width: 104, height: 22)
                Text("Gate \(state.gate) · \(attributes.seat)")
                    .font(.caption2)
                    .foregroundStyle(TripsPalette.subText)
            }
            .padding(.top, 14)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }
}

// MARK: - Pieces

/// "Boarding in 18 min" as a LIVE value: before boarding it is a system timer
/// bound to the instant, after it a plain phrase. The `timerInterval` form is
/// what keeps it right without an update.
@available(iOS 16.2, *)
private struct StatusText: View {
    let state: FlightActivityAttributes.ContentState
    let arrivalTime: String

    var body: some View {
        switch state.status {
        case .scheduled, .boardingSoon:
            if state.boardingAt > .now {
                // Interpolating a Text lets the countdown tick inside a
                // sentence — the whole line stays live, not just a number.
                Text("Boarding in \(Text(state.boardingAt, style: .timer))")
            } else {
                Text("Boarding now")
            }
        case .boarding:
            Text("Boarding · Gate \(state.gate)")
        case .departed:
            Text("In the air · lands \(arrivalTime)")
        case .landed:
            Text("Landed \(arrivalTime)")
        }
    }
}

@available(iOS 16.2, *)
private struct CompactCountdown: View {
    let state: FlightActivityAttributes.ContentState

    var body: some View {
        // Written as if/else rather than a switch with a `where` clause: in a
        // multi-pattern case the clause binds to the last pattern only, which
        // is a reading trap for exactly the condition that matters here.
        if state.status == .departed {
            Text("Air")
        } else if state.status == .landed {
            Text("Land")
        } else if state.boardingAt > .now {
            Text(state.boardingAt, style: .timer)
                .monospacedDigit()
        } else {
            Text("Board")
        }
    }
}

#endif
