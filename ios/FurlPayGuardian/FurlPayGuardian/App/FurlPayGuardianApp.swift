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

    var body: some View {
        Group {
            if container.isSignedIn {
                DashboardView()
            } else {
                SignInView()
            }
        }
        .background(GuardianColors.background.ignoresSafeArea())
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
