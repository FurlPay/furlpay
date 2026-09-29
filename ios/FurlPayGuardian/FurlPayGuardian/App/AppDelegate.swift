//
//  AppDelegate.swift
//
//  APNs registration and background-task wiring. SwiftUI exposes no lifecycle
//  hook for either, so the delegate stays.
//

import UIKit
import UserNotifications
import BackgroundTasks

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    static let syncTaskIdentifier = "com.furlpay.guardian.sync"

    @MainActor var container: ServiceContainer?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        // Must be registered BEFORE launch finishes or BGTaskScheduler throws.
        // This cannot be moved into a later lifecycle callback.
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.syncTaskIdentifier, using: nil
        ) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.handleBackgroundSync(refresh)
        }

        observeDeviceLock()

        // Installed at launch, not when a sensitive screen opens. The switcher
        // snapshot is taken on resign-active regardless of which screen is
        // showing, and deciding per-screen means every new screen is a chance to
        // forget. See PrivacyShield.swift for why RootView's SwiftUI overlay
        // cannot cover presented sheets on its own.
        //
        // MainActor.assumeIsolated rather than a Task: `didFinishLaunching` is
        // already on the main thread but is not itself MainActor-annotated, and a
        // Task would defer installation past the first frame — which is long
        // enough for a launch straight into the switcher to go unshielded.
        MainActor.assumeIsolated {
            PrivacyShield.shared.activate()
        }

        return true
    }

    // MARK: Device lock

    /// Drop the cached session token the moment the device locks.
    ///
    /// `KeychainTokenStore` writes the token with
    /// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, so the keychain stops
    /// serving it while the device is locked — but the store also keeps an
    /// in-memory copy to spare every API request a keychain round trip, and
    /// that copy has no such protection. Left alone, a background refresh
    /// firing while the phone sits locked on someone else's desk still carries
    /// a valid bearer token, which is exactly what the accessibility class was
    /// chosen to prevent.
    ///
    /// `protectedDataWillBecomeUnavailable` is the right signal: it fires when
    /// the data-protection class actually becomes unreadable, not merely when
    /// the app backgrounds (which also happens for the share sheet, the camera
    /// picker and the Face ID prompt itself — evicting on those would cost a
    /// keychain read every time the user came back).
    ///
    /// The session is NOT ended. `evictCache()` leaves the keychain item in
    /// place, so the first request after unlock reads it back and the user
    /// never sees a sign-in screen for having locked their phone.
    private func observeDeviceLock() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil,
            queue: nil
        ) { _ in
            Task { await KeychainTokenStore.shared.evictCache() }
        }
    }

    // MARK: Push

    func requestNotificationAuthorization() async {
        // .criticalAlert is requested but only honoured with Apple's
        // entitlement. Asking without it is harmless — it is simply ignored.
        let options: UNAuthorizationOptions = [.alert, .sound, .badge, .criticalAlert]
        guard let granted = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: options), granted else { return }
        await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        Task { @MainActor in
            guard let container else { return }
            try? await container.api.registerDevice(token: token)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Not fatal. The app works without push; it just cannot alert.
        print("APNs registration failed: \(error.localizedDescription)")
    }

    /// Show alerts even in the foreground: a payment or a critical reminder is
    /// worth interrupting the screen the user is already looking at.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await MainActor.run {
            container?.push.presentationOptions(for: notification) ?? [.banner, .sound, .list]
        }
    }

    /// The user tapped a notification. Routing lives in PushNotificationService.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        await MainActor.run { container?.push.handleTap(response) }
    }

    /// Silent push (`content-available: 1`).
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        let refreshed = await MainActor.run { self.container?.push }
        guard let push = refreshed else { return .noData }
        return await push.handleSilentPush(userInfo) ? .newData : .noData
    }

    // MARK: Background refresh

    private func handleBackgroundSync(_ task: BGAppRefreshTask) {
        scheduleBackgroundSync()   // reschedule first, always

        let work = Task { @MainActor in
            await container?.refreshAll()
            task.setTaskCompleted(success: true)
        }
        // The system grants a few seconds and terminates the app on overrun.
        task.expirationHandler = { work.cancel() }
    }

    func scheduleBackgroundSync() {
        let request = BGAppRefreshTaskRequest(identifier: Self.syncTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        // Throws if the identifier is absent from Info.plist's
        // BGTaskSchedulerPermittedIdentifiers.
        try? BGTaskScheduler.shared.submit(request)
    }
}
