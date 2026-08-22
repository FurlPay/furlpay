//
//  PushNotificationService.swift
//
//  Turns an APNs payload into something the app can act on. Registration itself
//  lives in AppDelegate (UIKit owns those callbacks); this file owns the two
//  things registration does not cover:
//
//    1. A tapped notification must land on the screen it is about. Without this
//       the alert is decoration — the user taps "Card frozen" and gets the
//       dashboard.
//    2. A silent push must refresh state without drawing anything.
//

import Foundation
import UserNotifications

// MARK: - Deep link

/// Where a notification wants the app to go.
///
/// Deliberately a closed enum rather than a URL: the payload is attacker-
/// influenced in the same sense any server-delivered content is, and an open
/// URL scheme would let a push address screens that were never meant to be
/// reachable that way. Anything unrecognised resolves to `nil` and the tap
/// simply opens the app.
public enum GuardianDeepLink: Equatable, Hashable, Sendable {
    case dashboard
    case cards
    case card(id: String)
    case wallet
    case spending
    case portfolio
    case markets
    case stock(symbol: String)
    case travel
    /// The boarding pass. A gate change is the single most useful push this app
    /// can send, and it must land on the pass rather than on the travel index.
    case boardingPass
    case reminders
    case passport
    case send
    case swap
    case earn
    case bills
    case credit
    case banking
    case settings
    case security
    case activity
    case support
    case rewards
    case insights
    case analytics
    case approvals
    case hotels
    /// Reachable from the menu but never from a payload — there is no useful
    /// notification whose answer is "show your own receive code".
    case quickPay

    /// `furlpay://<host>` — how a Live Activity's `widgetURL` and the watch's
    /// Smart Stack tiles hand a destination to the app.
    ///
    /// Routed through the SAME closed enum as the push payload, on purpose. A
    /// custom URL scheme is open to anything on the device that can call
    /// `openURL`, so treating the host as a free-form route would hand every
    /// other app on the phone a way to drive this one's navigation.
    init?(url: URL) {
        guard url.scheme == "furlpay", let host = url.host() else { return nil }
        let path = url.path().trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.init(payload: ["link": path.isEmpty ? host : path])
    }

    /// APNs carries this in the custom `link` key alongside `aps`.
    init?(payload: [AnyHashable: Any]) {
        guard let raw = payload["link"] as? String else { return nil }
        let parts = raw.split(separator: ":", maxSplits: 1).map(String.init)
        let id = parts.count > 1 ? parts[1] : nil

        switch parts[0] {
        case "dashboard":  self = .dashboard
        case "cards":      self = .cards
        case "card":       guard let id, !id.isEmpty else { return nil }; self = .card(id: id)
        case "wallet":     self = .wallet
        case "spending":   self = .spending
        case "portfolio":  self = .portfolio
        case "markets":    self = .markets
        case "stock":      guard let id, !id.isEmpty else { return nil }
                           self = .stock(symbol: id.uppercased())
        case "travel":     self = .travel
        case "boardingPass", "boarding-pass":
                           self = .boardingPass
        case "reminders":  self = .reminders
        case "passport":   self = .passport
        case "send":       self = .send
        case "swap":       self = .swap
        case "earn":       self = .earn
        case "bills":      self = .bills
        case "credit":     self = .credit
        case "banking":    self = .banking
        case "settings":   self = .settings
        case "security":   self = .security
        case "activity":   self = .activity
        case "support":    self = .support
        case "rewards":    self = .rewards
        case "insights":   self = .insights
        case "analytics":  self = .analytics
        case "approvals":  self = .approvals
        case "hotels":     self = .hotels
        default:           return nil
        }
    }
}

// MARK: - Service

@MainActor
@Observable
public final class PushNotificationService {

    /// Consumed by the root view, which navigates and then clears it.
    ///
    /// Held rather than delivered as a callback because a notification can be
    /// tapped while the app is not running: the payload arrives during launch,
    /// before any view exists to receive it.
    public var pendingLink: GuardianDeepLink?

    public private(set) var lastSilentRefresh: Date?

    private weak var container: ServiceContainer?

    public init() {}

    public func attach(container: ServiceContainer) {
        self.container = container
    }

    // MARK: Foreground presentation

    /// Show alerts even when the app is open. A card decline or a payment
    /// request is worth interrupting whatever screen is already up; anything
    /// less urgent should not have been a push in the first place.
    public func presentationOptions(
        for notification: UNNotification
    ) -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    // MARK: Taps

    public func handleTap(_ response: UNNotificationResponse) {
        let payload = response.notification.request.content.userInfo

        // A locally-scheduled alarm rung — present the full-screen alarm rather
        // than navigating. iOS gives no way to draw over the lock screen, so
        // this tap IS the alarm's arrival on screen.
        if let eventId = payload[AlarmScheduler.eventIdKey] as? String,
           let container,
           let event = container.events.events.first(where: { $0.id == eventId }) {
            container.alarmPresenter.present(event)
            return
        }

        pendingLink = GuardianDeepLink(payload: payload) ?? .dashboard

        // A tap is the strongest signal we get that the user is looking at the
        // app; whatever the notification is about is probably stale by now.
        Task { await container?.refreshAll() }
    }

    public func consumeLink() -> GuardianDeepLink? {
        defer { pendingLink = nil }
        return pendingLink
    }

    // MARK: Silent pushes

    /// Handles `content-available: 1`. Returns the fetch result iOS uses to
    /// decide how generously to deliver future silent pushes — reporting
    /// `.newData` unconditionally is a good way to get throttled, so this
    /// reports honestly.
    public func handleSilentPush(_ payload: [AnyHashable: Any]) async -> Bool {
        guard let container else { return false }
        await container.refreshAll()
        lastSilentRefresh = Date()

        // The watch is the reason silent push is worth having at all: it lets a
        // complication update without the user opening anything.
        await container.sync.pushAllSnapshots(from: container)
        return true
    }
}
