//
//  DashboardView.swift
//
//  Port of DashboardScreen from the Android MainActivity: net worth, card
//  carousel, next trip, reminders, and the watch sync control.
//

import SwiftUI

struct DashboardView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var showNewReminder = false
    @State private var showTopUp = false
    @State private var showTapToPay = false
    @State private var showSend = false
    @State private var showSwap = false
    @State private var syncFeedback: String?
    /// Value-typed so a push notification can push onto it. See
    /// PushNotificationService.
    @State private var path: [GuardianDeepLink] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    netWorth
                    if !container.cards.cards.isEmpty { cardCarousel }
                    if let trip = container.travel.activeTrips.first { tripCard(trip) }
                    RemindersSection(showNewReminder: $showNewReminder)
                    voiceButton
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .background(GuardianColors.background.ignoresSafeArea())
            .refreshable { await container.refreshAll() }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        NavigationLink("Wallet", value: GuardianDeepLink.wallet)
                        NavigationLink("Cards", value: GuardianDeepLink.cards)
                        NavigationLink("Markets", value: GuardianDeepLink.markets)
                        NavigationLink("Portfolio", value: GuardianDeepLink.portfolio)
                        NavigationLink("Spending", value: GuardianDeepLink.spending)
                        NavigationLink("Travel", value: GuardianDeepLink.travel)
                        NavigationLink("Documents", value: GuardianDeepLink.passport)
                        NavigationLink("Earn", value: GuardianDeepLink.earn)
                        NavigationLink("Bills", value: GuardianDeepLink.bills)
                        NavigationLink("Credit", value: GuardianDeepLink.credit)
                        NavigationLink("Activity", value: GuardianDeepLink.activity)
                        NavigationLink("Approvals", value: GuardianDeepLink.approvals)
                        NavigationLink("Insights", value: GuardianDeepLink.insights)
                        NavigationLink("Rewards", value: GuardianDeepLink.rewards)
                        NavigationLink("Support", value: GuardianDeepLink.support)
                        NavigationLink("Settings", value: GuardianDeepLink.settings)
                        NavigationLink("Receive", value: GuardianDeepLink.quickPay)
                        Divider()
                        Button("Add Funds", systemImage: "plus.circle") {
                            showTopUp = true
                        }
                        Button("Take Payment", systemImage: "wave.3.right") {
                            showTapToPay = true
                        }
                        Button("Send", systemImage: "arrow.up.right") { showSend = true }
                        Button("Swap", systemImage: "arrow.left.arrow.right") { showSwap = true }
                        Divider()
                        Button("Sign Out", role: .destructive) {
                            Task { await container.signOut() }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showNewReminder) {
                NewReminderSheet()
            }
            .sheet(isPresented: $showTopUp) {
                TopUpView()
            }
            .sheet(isPresented: $showTapToPay) {
                TapToPayView()
            }
            .sheet(isPresented: $showSend) { SendView() }
            .sheet(isPresented: $showSwap) { SwapView() }
            .navigationDestination(for: GuardianDeepLink.self) { destination($0) }
        }
        .tint(GuardianColors.primaryAccent)
        // A notification tapped while the app was not running arrives before
        // this view exists, so the link is polled rather than pushed to us.
        .onChange(of: container.push.pendingLink) { _, newValue in
            guard newValue != nil, let link = container.push.consumeLink() else { return }
            navigate(to: link)
        }
        .task {
            if let link = container.push.consumeLink() { navigate(to: link) }
        }
    }

    /// Replaces the stack rather than appending: two notifications in a row
    /// should not build a back-stack the user never navigated through.
    private func navigate(to link: GuardianDeepLink) {
        switch link {
        // Both render at the root — reminders are a section of this screen, not
        // a destination of their own.
        case .dashboard, .reminders: path = []
        default:                     path = [link]
        }
    }

    @ViewBuilder
    private func destination(_ link: GuardianDeepLink) -> some View {
        switch link {
        // `card(id:)` opens the card list rather than one card: the list shows
        // every card's state, so it answers the notification either way.
        case .cards, .card:          CardsView()
        case .wallet:                WalletView()
        case .spending:              SpendingView()
        case .portfolio:             PortfolioView()
        case .markets:               MarketsView()
        case .stock(let symbol):     StockDetailView(symbol: symbol)
        case .travel:                TravelView()
        case .quickPay:              QuickPayView()
        case .passport:              PassportVaultView()
        case .earn:                  EarnView()
        case .bills:                 BillsView()
        case .credit:                CreditView()
        case .banking:               BankingView()
        case .settings:              SettingsView()
        case .security:              SecurityView()
        case .activity:              TransactionsView()
        case .support:               SupportView()
        case .rewards:               RewardsView()
        case .insights:              InsightsView()
        case .analytics:             AnalyticsView()
        case .approvals:             ApprovalsView()
        case .hotels:                HotelsView()
        // Send and Swap are sheets, not pushes — they are tasks with a
        // beginning and an end, and a back button mid-payment invites a
        // half-finished send.
        case .send, .swap:           EmptyView()
        case .dashboard, .reminders: EmptyView()   // never pushed; see navigate(to:)
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(Date.greeting)
                .font(.title3.weight(.semibold))
                .foregroundStyle(GuardianColors.textPrimary)
            Spacer()
            Button {
                Task {
                    await container.sync.pushAllSnapshots(from: container)
                    syncFeedback = container.sync.isPaired ? "Watch synced" : "No watch paired"
                }
            } label: {
                Label(syncFeedback ?? "Sync Watch", systemImage: "applewatch")
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(GuardianColors.primaryAccent)
        }
        .padding(.top, 8)
    }

    private var netWorth: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Net Worth")
                .font(.caption)
                .foregroundStyle(GuardianColors.textSecondary)

            Text(container.wallets.totalUsd.usd)
                .font(.system(size: 38, weight: .semibold, design: .rounded))
                .foregroundStyle(GuardianColors.textPrimary)
                .contentTransition(.numericText())   // digits roll rather than pop

            if let portfolio = container.portfolio.summary {
                HStack(spacing: 4) {
                    Image(systemName: portfolio.dayChangePercent >= 0 ? "arrow.up.right" : "arrow.down.right")
                    Text("\(portfolio.dayChangeUsd.usd) · \(portfolio.dayChangePercent.signedPercent) today")
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(GuardianColors.forChange(portfolio.dayChangePercent))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var cardCarousel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Cards").sectionTitle()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(container.cards.cards) { card in
                        NavigationLink { CardsView() } label: { MiniCardView(card: card) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func tripCard(_ trip: TravelBooking) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Upcoming Trip").sectionTitle()
            NavigationLink { TravelView() } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(trip.destination)
                            .font(.headline)
                            .foregroundStyle(GuardianColors.textPrimary)
                        Text("\(trip.startDate.dayAndMonth) – \(trip.endDate.dayAndMonth)")
                            .font(.caption)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                    Spacer()
                    if let flights = trip.flights, !flights.isEmpty {
                        Text("\(flights.count) flight\(flights.count == 1 ? "" : "s")")
                            .font(.caption)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(GuardianColors.textTertiary)
                }
                .padding(16)
                .background(GuardianColors.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private var voiceButton: some View {
        NavigationLink { LiveVoiceView() } label: {
            Label("Ask Guardian", systemImage: "mic.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(GuardianColors.primaryAccent.opacity(0.16))
                .foregroundStyle(GuardianColors.primaryAccent)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

struct MiniCardView: View {
    let card: Card

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(card.network == .visa ? "VISA" : card.network == .mastercard ? "MC" : "CARD")
                    .font(.caption2.weight(.bold))
                Spacer()
                if card.frozen {
                    Image(systemName: "snowflake").font(.caption)
                }
            }
            Spacer()
            Text("•••• \(card.last4)")
                .font(.callout.monospacedDigit())
            Text(card.label)
                .font(.caption2)
                .foregroundStyle(GuardianColors.textSecondary)
                .lineLimit(1)
        }
        .padding(14)
        .frame(width: 150, height: 96, alignment: .leading)
        .background(card.frozen ? GuardianColors.surfaceElevated : GuardianColors.surface)
        .foregroundStyle(card.frozen ? GuardianColors.textSecondary : GuardianColors.textPrimary)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(GuardianColors.primaryAccent.opacity(card.frozen ? 0 : 0.25), lineWidth: 1)
        }
    }
}

extension Text {
    func sectionTitle() -> some View {
        self.font(.caption.weight(.semibold))
            .foregroundStyle(GuardianColors.textSecondary)
            .textCase(.uppercase)
    }
}
