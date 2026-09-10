//
//  FurlPayGuardianApp.swift
//

import SwiftUI

@main
struct FurlPayGuardianApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var container = ServiceContainer()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(container)
                .preferredColorScheme(.dark)   // AMOLED theme; there is no light variant
                .task {
                    appDelegate.container = container
                    await container.bootstrap()
                    await appDelegate.requestNotificationAuthorization()
                    appDelegate.scheduleBackgroundSync()
                }
        }
    }
}

struct RootView: View {
    @Environment(ServiceContainer.self) private var container
    @Environment(\.scenePhase) private var scenePhase
    @State private var leftForegroundAt: Date?

    /// Matches the Android app's short background grace period: it avoids
    /// re-prompting after a camera picker or Face ID sheet, but prevents a
    /// session left in the app switcher from becoming an unattended dashboard.
    private let lockAfterBackground: TimeInterval = 30

    var body: some View {
        Group {
            if container.isSignedIn && container.isSessionLocked {
                SessionLockView()
            } else if container.isSignedIn {
                DashboardView()
            } else {
                SignInView()
            }
        }
        .background(GuardianColors.background.ignoresSafeArea())
        // App-switcher privacy. iOS snapshots the window the moment the app
        // resigns active, and that image — approval amounts, security events —
        // persists in the switcher for anyone holding the phone. Covering on
        // every non-active phase is deliberate: .inactive is exactly when the
        // snapshot is taken, so an overlay only on .background arrives too
        // late. The Android app takes the same posture with FLAG_SECURE.
        .overlay {
            if scenePhase != .active {
                ZStack {
                    GuardianColors.background.ignoresSafeArea()
                    Image(systemName: "shield.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(.secondary)
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.15), value: scenePhase)
        // Tapping the flight Live Activity opens furlpay://boarding-pass. It is
        // parked on the same `pendingLink` a notification tap uses, so there is
        // one path into navigation rather than two that can disagree.
        .onOpenURL { url in
            guard let link = GuardianDeepLink(url: url) else { return }
            container.push.pendingLink = link
        }
        // A crossfade rather than a push: signing in is not navigation, and a
        // slide implies a back gesture that does not exist.
        .animation(.easeInOut(duration: 0.25), value: container.isSignedIn)
        .animation(.easeInOut(duration: 0.2), value: container.isSessionLocked)
        .onChange(of: scenePhase) { _, next in
            guard container.isSignedIn else { return }
            if next == .active {
                defer { leftForegroundAt = nil }
                guard let leftForegroundAt,
                      Date().timeIntervalSince(leftForegroundAt) >= lockAfterBackground else { return }
                container.lockSession()
            } else if leftForegroundAt == nil {
                leftForegroundAt = Date()
            }
        }
        // Presented at the ROOT, above every screen and every other sheet — a
        // ringing alarm that a modal could hide would be worse than no alarm.
        .fullScreenCover(item: alarmBinding) { event in
            AlarmView(event: event, presenter: container.alarmPresenter)
                .environment(container)
        }
    }

    private var alarmBinding: Binding<GuardianEvent?> {
        Binding(
            get: { container.alarmPresenter.ringing },
            // Swiping the sheet away is a dismiss, NOT an acknowledgement: the
            // escalation ladder stays armed. Only the button acknowledges.
            set: { if $0 == nil { container.alarmPresenter.dismiss() } }
        )
    }
}

/// A distinct session-lock screen, rather than a dashboard overlay, keeps
/// balances and transactions out of both VoiceOver traversal and the view tree
/// while the session is protected.
private struct SessionLockView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var result: BiometricResult?

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(GuardianColors.primaryAccent)
                .accessibilityHidden(true)
            Text("FurlPay is locked")
                .font(.title2.weight(.semibold))
                .foregroundStyle(GuardianColors.textPrimary)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(GuardianColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Unlock securely") { attemptUnlock() }
                .buttonStyle(GuardianPrimaryButtonStyle())
                .padding(.horizontal, 24)
            Button("Sign out", role: .destructive) {
                Task { await container.signOut() }
            }
            .font(.footnote)
            Spacer()
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .task { attemptUnlock() }
    }

    private var message: String {
        switch result {
        case .some(.denied):
            "Authentication was not completed. Try again or sign out."
        case .some(.unavailable):
            "Face ID or Touch ID is unavailable. Enable it in Settings, then try again."
        default:
            "Use Face ID or Touch ID to return to your account."
        }
    }

    private func attemptUnlock() {
        Task { result = await container.unlockSession() }
    }
}

private struct GuardianPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(GuardianColors.primaryAccent.opacity(configuration.isPressed ? 0.8 : 1))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
