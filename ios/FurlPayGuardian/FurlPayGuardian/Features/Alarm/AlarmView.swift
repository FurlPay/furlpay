//
//  AlarmView.swift
//
//  Port of AlarmActivity.kt and the ringing half of AlarmService.kt.
//
//  What is happening, and ONE action: acknowledge. Dismissing without
//  acknowledging leaves the ladder armed — by design, and the same rule as
//  Android. A reminder the user swipes away by reflex at 3am has not been
//  handled.
//
//  WHERE THIS DIFFERS FROM ANDROID, UNAVOIDABLY: there is no iOS equivalent of
//  `setShowWhenLocked` / `setTurnScreenOn`. A third-party app cannot draw over
//  the lock screen or wake the display. The closest iOS offers is a
//  time-sensitive or critical notification, which the user taps to reach this
//  screen. So the escalation ladder lives in AlarmScheduler (staged
//  notifications) and this view is what they land on — it cannot be what wakes
//  them.
//

import SwiftUI
import AVFoundation

@MainActor
@Observable
public final class AlarmPresenter {
    /// The event currently ringing. Setting it presents the sheet.
    public var ringing: GuardianEvent?

    private var player: AVAudioPlayer?
    private var haptics: Timer?

    public init() {}

    public func present(_ event: GuardianEvent) {
        ringing = event
        startEffects(intensity: event.priority)
    }

    /// Acknowledged — stop everything and disarm the rest of the ladder.
    public func acknowledge(_ container: ServiceContainer) {
        guard let event = ringing else { return }
        stopEffects()
        container.events.acknowledge(event.id)
        Task { await container.alarms.cancel(event.id) }
        ringing = nil
    }

    /// Dismissed WITHOUT acknowledging. Effects stop (the phone is in the
    /// user's hand, it has been noticed) but the ladder stays armed.
    public func dismiss() {
        stopEffects()
        ringing = nil
    }

    private func startEffects(intensity: EventPriority) {
        guard intensity == .critical || intensity == .high else { return }

        // `.playback` with `mixWithOthers` off so the alarm is audible over
        // music. Critical alarms additionally ignore the ringer switch, which
        // requires the critical-alert entitlement to be honoured.
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)

        if let url = Bundle.main.url(forResource: "alarm", withExtension: "caf") {
            player = try? AVAudioPlayer(contentsOf: url)
            player?.numberOfLoops = -1
            player?.play()
        }

        // Repeating haptic. iOS has no "vibrate until stopped" API, so it is
        // driven on a timer — the Android AlarmEffects waveform equivalent.
        let interval: TimeInterval = intensity == .critical ? 1.0 : 2.5
        haptics = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            Task { @MainActor in
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            }
        }
    }

    private func stopEffects() {
        player?.stop()
        player = nil
        haptics?.invalidate()
        haptics = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}

public struct AlarmView: View {
    @Environment(ServiceContainer.self) private var container
    let event: GuardianEvent
    let presenter: AlarmPresenter

    @State private var pulse = false

    public var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: event.priority == .critical ? "exclamationmark.triangle.fill" : "bell.fill")
                .font(.system(size: 56))
                .foregroundStyle(event.priority == .critical
                                 ? GuardianColors.negative : GuardianColors.warning)
                .scaleEffect(pulse ? 1.08 : 1.0)
                .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulse)

            VStack(spacing: 8) {
                Text(event.title)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(GuardianColors.textPrimary)

                if let detail = event.detail {
                    Text(detail)
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(GuardianColors.textSecondary)
                }

                Text(event.startAt.formatted(date: .omitted, time: .shortened))
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(GuardianColors.textTertiary)
            }

            Spacer()

            Button {
                presenter.acknowledge(container)
            } label: {
                Text("Acknowledge")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
            .buttonStyle(.borderedProminent)
            .tint(GuardianColors.primaryAccent)
            // Spring entrance, per the motion bible the Android build follows.
            .scaleEffect(pulse ? 1.0 : 0.92)
            .animation(.spring(response: 0.5, dampingFraction: 0.6), value: pulse)

            // No "snooze". The ladder is the snooze, and a second mechanism
            // would let a CRITICAL reminder be deferred indefinitely.
            Text("Closing this leaves the reminder armed.")
                .font(.caption2)
                .foregroundStyle(GuardianColors.textTertiary)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
        .interactiveDismissDisabled(event.priority == .critical)
        .onAppear { pulse = true }
    }
}
