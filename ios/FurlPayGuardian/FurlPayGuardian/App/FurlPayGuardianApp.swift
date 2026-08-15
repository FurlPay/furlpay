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

    var body: some View {
        Group {
            if container.isSignedIn {
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
        // A crossfade rather than a push: signing in is not navigation, and a
        // slide implies a back gesture that does not exist.
        .animation(.easeInOut(duration: 0.25), value: container.isSignedIn)
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
