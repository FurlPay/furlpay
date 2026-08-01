//
//  MoreScreens.swift
//
//  Ports of native-app/app/{rewards,chains,analytics,insights,approvals,
//  collection/[slug]}.tsx.
//
//  Grouped in one file because each is a single read-only list over one
//  endpoint. Six files of forty lines each would be filing, not structure.
//  Approvals is the exception in kind — it MUTATES — and its confirm path goes
//  through the registry like every other one.
//

import SwiftUI

// MARK: - Rewards

struct RewardsView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var rewards: RewardsOverview?

    var body: some View {
        List {
            if let rewards {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(rewards.points)")
                            .font(.system(size: 40, weight: .semibold, design: .rounded))
                            .foregroundStyle(GuardianColors.primaryAccent)
                            .contentTransition(.numericText())
                        Text("points · \(rewards.tier)")
                            .font(.subheadline)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                    .padding(.vertical, 6)
                }
                .listRowBackground(GuardianColors.surface)

                if !rewards.history.isEmpty {
                    Section("Recent") {
                        ForEach(rewards.history) { entry in
                            HStack {
                                Text(entry.reason).foregroundStyle(GuardianColors.textPrimary)
                                Spacer()
                                Text("+\(entry.points)")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(GuardianColors.positive)
                            }
                            .font(.subheadline)
                        }
                    }
                    .listRowBackground(GuardianColors.surface)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Rewards")
        .navigationBarTitleDisplayMode(.inline)
        .task { rewards = try? await container.api.fetchRewards() }
    }
}

// MARK: - Chains

struct ChainsView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var chains: [ChainInfo] = []

    var body: some View {
        List {
            Section {
                Text("Networks FurlPay can move money across. Fees and finality differ; the app picks the cheapest route that meets your speed.")
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textSecondary)
            }
            .listRowBackground(GuardianColors.surface)

            Section("Networks") {
                ForEach(chains) { chain in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(chain.name)
                                .font(.subheadline)
                                .foregroundStyle(GuardianColors.textPrimary)
                            if let finality = chain.finalitySeconds {
                                Text("~\(finality)s finality")
                                    .font(.caption2)
                                    .foregroundStyle(GuardianColors.textTertiary)
                            }
                        }
                        Spacer()
                        if let fee = chain.typicalFeeUsd {
                            Text(fee.usd)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(GuardianColors.textSecondary)
                        }
                        Circle()
                            .fill(chain.enabled ? GuardianColors.positive : GuardianColors.textTertiary)
                            .frame(width: 8, height: 8)
                            .accessibilityLabel(chain.enabled ? "Enabled" : "Disabled")
                    }
                }
            }
            .listRowBackground(GuardianColors.surface)
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Networks")
        .navigationBarTitleDisplayMode(.inline)
        .task { chains = (try? await container.api.fetchChains()) ?? [] }
    }
}

// MARK: - Insights

struct InsightsView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var insights: [Insight] = []

    var body: some View {
        List {
            if insights.isEmpty {
                Section {
                    Text("No insights yet. They appear once there's enough activity to say something useful.")
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .listRowBackground(GuardianColors.surface)
            } else {
                ForEach(insights) { insight in
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(insight.title, systemImage: icon(for: insight.severity))
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(tint(for: insight.severity))
                            Text(insight.detail)
                                .font(.subheadline)
                                .foregroundStyle(GuardianColors.textSecondary)
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowBackground(GuardianColors.surface)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Insights")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { insights = (try? await container.api.fetchInsights()) ?? [] }
        .task { insights = (try? await container.api.fetchInsights()) ?? [] }
    }

    private func icon(for severity: String) -> String {
        switch severity.lowercased() {
        case "warning", "high": "exclamationmark.triangle.fill"
        case "positive", "good": "checkmark.circle.fill"
        default: "lightbulb"
        }
    }

    private func tint(for severity: String) -> Color {
        switch severity.lowercased() {
        case "warning", "high": GuardianColors.warning
        case "positive", "good": GuardianColors.positive
        default: GuardianColors.primaryAccent
        }
    }
}

// MARK: - Analytics

struct AnalyticsView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var analytics: AnalyticsOverview?

    var body: some View {
        List {
            if let analytics {
                Section("This month") {
                    LabeledContent("Spent", value: analytics.spentUsd.usd)
                    LabeledContent("Received", value: analytics.receivedUsd.usd)
                    LabeledContent("Net", value: (analytics.receivedUsd - analytics.spentUsd).usd)
                }
                .listRowBackground(GuardianColors.surface)

                if !analytics.byCategory.isEmpty {
                    Section("By category") {
                        ForEach(analytics.byCategory) { slice in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(slice.category).foregroundStyle(GuardianColors.textPrimary)
                                    Spacer()
                                    Text(slice.amountUsd.usd)
                                        .font(.subheadline.monospacedDigit())
                                        .foregroundStyle(GuardianColors.textSecondary)
                                }
                                ProgressView(value: share(slice, of: analytics))
                                    .tint(GuardianColors.primaryAccent)
                            }
                            .font(.subheadline)
                        }
                    }
                    .listRowBackground(GuardianColors.surface)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Analytics")
        .navigationBarTitleDisplayMode(.inline)
        .task { analytics = try? await container.api.fetchAnalytics() }
    }

    /// Guards the divide-by-zero a first-month account produces.
    private func share(_ slice: CategorySlice, of overview: AnalyticsOverview) -> Double {
        guard overview.spentUsd > 0 else { return 0 }
        return min((slice.amountUsd / overview.spentUsd).doubleValue, 1)
    }
}

// MARK: - Approvals

/// Pending 3DS2 out-of-band card approvals: a transaction the issuer is holding
/// until the cardholder says yes on a device they control.
///
/// THIS SCREEN USED TO BE SOMETHING ELSE, AND THE DIFFERENCE IS THE POINT. It
/// fetched a list of server-authored `Confirmation` objects — action id,
/// endpoint, body, a free-form `summary` and an `amountUsd` — rendered ONLY the
/// summary and that amount, and dispatched on Approve. So the figure the user
/// read came from the payload rather than from the request, and a
/// prompt-injected or compromised response could show "Send $5.00 to Alice"
/// over a body carrying $25,000 to somewhere else. (The endpoint it read from
/// did not exist either, so the screen was permanently empty — the hole was
/// latent, not live.)
///
/// A challenge has no action to name: the amount and the merchant come from the
/// issuer's authorisation request, and the only thing the user decides is
/// approve or decline. There is nothing here for a payload to steer.
struct ApprovalsView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var challenges: [CardChallenge] = []
    @State private var working: String?
    @State private var error: String?

    var body: some View {
        List {
            if challenges.isEmpty {
                Section {
                    Text("Nothing waiting on you.")
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .listRowBackground(GuardianColors.surface)
            } else {
                ForEach(challenges) { challenge in
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(challenge.merchant)
                                .font(.subheadline)
                                .foregroundStyle(GuardianColors.textPrimary)
                            Text(Decimal(challenge.amountUsd).usd)
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(GuardianColors.textPrimary)
                            if let expiresAt = challenge.expiresAt {
                                Text("Expires \(expiresAt.formatted(date: .omitted, time: .shortened))")
                                    .font(.caption)
                                    .foregroundStyle(GuardianColors.textSecondary)
                            }
                            HStack(spacing: 12) {
                                Button("Approve") { decide(challenge, approved: true) }
                                    .buttonStyle(.borderedProminent)
                                    .tint(GuardianColors.primaryAccent)
                                Button("Decline", role: .destructive) {
                                    decide(challenge, approved: false)
                                }
                                .buttonStyle(.bordered)
                            }
                            .disabled(working != nil)
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowBackground(GuardianColors.surface)
                }
            }

            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(GuardianColors.negative) }
                    .listRowBackground(GuardianColors.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Approvals")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        challenges = (try? await container.api.fetchCardChallenges()) ?? []
    }

    private func decide(_ challenge: CardChallenge, approved: Bool) {
        working = challenge.id
        Task {
            defer { working = nil }
            error = nil

            // Approving releases money, so it is gated. Declining is the safe
            // direction and is not — making someone Face ID a refusal only
            // teaches them to authenticate reflexively.
            if approved {
                let amount = GuardianActionRegistry.formatUsd(challenge.amountUsd)
                guard await container.biometrics
                    .authenticate(reason: "Approve \(amount) at \(challenge.merchant)")
                    .isAuthenticated
                else {
                    error = "Not confirmed."
                    return
                }
            }

            do {
                try await container.api.decideCardChallenge(id: challenge.id, approved: approved)
                await load()
            } catch {
                self.error = approved
                    ? "Could not approve that payment."
                    : "Could not decline that payment."
            }
        }
    }
}

// MARK: - Collection

/// One slice of the market catalog — the `kind` filter /api/markets accepts.
///
/// Was pointed at `/api/collection/{slug}`, which does not exist, so the grid
/// was always empty. /api/markets is the same source the RN app's collection
/// screen reads.
struct CollectionView: View {
    @Environment(ServiceContainer.self) private var container
    let slug: String

    @State private var items: [MarketQuote] = []

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        AssetLogo(symbol: item.symbol, logoPath: nil, size: 56)
                        Text(item.name)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(GuardianColors.textPrimary)
                            .lineLimit(2)
                        if let price = item.price {
                            Text(price.usd)
                                .font(.caption2)
                                .foregroundStyle(GuardianColors.textTertiary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(GuardianColors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(16)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle(slug.replacingOccurrences(of: "-", with: " ").capitalized)
        .navigationBarTitleDisplayMode(.inline)
        .task { items = (try? await container.api.fetchCollection(slug: slug)) ?? [] }
    }
}
