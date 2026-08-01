//
//  WatchApp.swift
//
//  Apple Watch app. Offline-first: every screen renders from the last snapshot
//  the phone pushed, and the network is a fallback rather than the source.
//  A watch face that spins while the phone is in another room is useless.
//

import SwiftUI
import WatchConnectivity

@main
struct FurlPayGuardianWatchApp: App {
    @State private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environment(store)
                .task { store.activate() }
                // Smart Stack tiles deep-link with furlpay://<route>. Replaces
                // the stack rather than appending — the tile is a jump, not a
                // step in a journey the user walked.
                .onOpenURL { url in
                    guard let route = WatchRoute(deepLink: url) else { return }
                    store.path = [route]
                }
        }
    }
}

/// The watch's whole state: one snapshot plus navigation.
@MainActor
@Observable
final class WatchStore {
    var snapshot: GuardianSnapshot = SnapshotCache.load() ?? GuardianSnapshot()
    var path: [WatchRoute] = []
    var isReachable = false
    /// Set by the phone at sign-in and persisted to the watch keychain.
    var hasToken = false

    private let connectivity = WatchConnectivityService()

    func activate() {
        connectivity.onSnapshot = { [weak self] snapshot in
            guard let self else { return }
            self.snapshot = snapshot
            SnapshotCache.save(snapshot)
        }
        connectivity.onToken = { [weak self] token in
            guard let self else { return }
            Task {
                try? await KeychainTokenStore.shared.save(token)
                self.hasToken = true
            }
        }
        connectivity.onReachabilityChange = { [weak self] reachable in
            self?.isReachable = reachable
        }
        connectivity.activate()

        Task { hasToken = await KeychainTokenStore.shared.get() != nil }
    }

    func requestRefresh() { connectivity.requestRefresh() }

    func ask(_ question: String) async -> String {
        await connectivity.relayVoice(question)
    }
}

enum WatchRoute: String, Hashable, CaseIterable {
    case wallet, cards, voice, portfolio, spending, quickpay, markets, travel

    var title: String {
        switch self {
        case .wallet: "Wallet"
        case .cards: "Cards"
        case .voice: "Ask"
        case .portfolio: "Portfolio"
        case .spending: "Spending"
        case .quickpay: "Receive"
        case .markets: "Markets"
        case .travel: "Travel"
        }
    }

    /// Resolves a Smart Stack tile's `furlpay://<host>` URL.
    ///
    /// Matched against a closed set, like the phone's GuardianDeepLink: a tile
    /// is app-authored so the risk is lower, but keeping one rule for both
    /// means there is no second, laxer path into navigation.
    init?(deepLink url: URL) {
        guard url.scheme == "furlpay", let host = url.host() else { return nil }
        switch host {
        case "wallet":    self = .wallet
        case "cards":     self = .cards
        case "portfolio": self = .portfolio
        case "spending":  self = .spending
        case "markets":   self = .markets
        case "travel":    self = .travel
        case "quickpay":  self = .quickpay
        // The event feed lives on the home screen, so an event tile lands at
        // the root rather than pushing a screen that does not exist.
        case "events":    return nil
        default:          return nil
        }
    }

    var icon: String {
        switch self {
        case .wallet: "wallet.bifold"
        case .cards: "creditcard"
        case .voice: "mic.fill"
        case .portfolio: "chart.pie"
        case .spending: "arrow.down.circle"
        case .quickpay: "qrcode"
        case .markets: "chart.line.uptrend.xyaxis"
        case .travel: "airplane"
        }
    }
}

struct WatchRootView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.path) {
            WatchHomeView()
                .navigationDestination(for: WatchRoute.self) { route in
                    switch route {
                    case .wallet: WatchWalletView()
                    case .cards: WatchCardsView()
                    case .voice: WatchVoiceView()
                    case .portfolio: WatchPortfolioView()
                    case .spending: WatchSpendingView()
                    case .quickpay: WatchQuickPayView()
                    case .markets: WatchMarketsView()
                    case .travel: WatchTravelView()
                    }
                }
                .navigationDestination(for: String.self) { symbol in
                    WatchStockView(symbol: symbol)
                }
        }
    }
}
