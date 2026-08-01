//
//  CreditView.swift
//
//  Port of native-app/app/credit.tsx — a collateral-backed borrowing line.
//
//  The health factor is the number that matters: below 1.0 the position is
//  liquidated. So it is the largest element, it is banded (safe / watch / at
//  risk) rather than left as a bare float, and when nothing is drawn it renders
//  as "—" rather than a misleading zero.
//

import SwiftUI

struct CreditView: View {
    @Environment(ServiceContainer.self) private var container

    private var repository: CreditRepository { container.credit }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let line = repository.line {
                    healthCard(line)
                    capacityCard(line)
                    collateral(line)
                    terms(line)
                } else if repository.isLoading {
                    ProgressView().tint(GuardianColors.primaryAccent)
                        .frame(maxWidth: .infinity).padding(.vertical, 48)
                } else {
                    Text("No credit line yet.")
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)
                        .frame(maxWidth: .infinity).padding(.vertical, 48)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Credit")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await repository.refresh() }
        .task { await repository.refresh() }
    }

    private func healthCard(_ line: CreditLine) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Health factor").sectionTitle()
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(line.healthFactor.map { $0.twoDecimals } ?? "—")
                    .font(.system(size: 40, weight: .semibold, design: .rounded))
                    .foregroundStyle(healthColour(line))
                if let band = line.healthBand {
                    Text(band.label)
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(healthColour(line).opacity(0.16))
                        .foregroundStyle(healthColour(line))
                        .clipShape(Capsule())
                }
            }
            Text(line.healthFactor == nil
                 ? "Nothing borrowed — nothing at risk."
                 : "Liquidation happens below 1.00.")
                .font(.caption)
                .foregroundStyle(GuardianColors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func capacityCard(_ line: CreditLine) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                metric("Available", line.available.usd, GuardianColors.positive)
                Spacer()
                metric("Drawn", line.drawn.usd, GuardianColors.textPrimary)
                Spacer()
                metric("Power", line.borrowingPower.usd, GuardianColors.textSecondary)
            }
            ProgressView(value: min(max(line.utilizationPct / 100, 0), 1))
                .tint(line.utilizationPct > 80 ? GuardianColors.negative : GuardianColors.primaryAccent)
            Text("\(line.utilizationPct.oneDecimal)% used · LTV \(line.currentLtvPct.oneDecimal)% of \(line.maxLtvPct.oneDecimal)% max")
                .font(.caption2)
                .foregroundStyle(GuardianColors.textTertiary)
        }
        .padding(18)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func metric(_ label: String, _ value: String, _ colour: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(GuardianColors.textTertiary)
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(colour)
        }
    }

    private func collateral(_ line: CreditLine) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Collateral").sectionTitle()
            ForEach(line.collateral) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.label)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Text("\(item.kind.capitalized) · \(item.ltv.oneDecimal)% LTV")
                            .font(.caption2)
                            .foregroundStyle(GuardianColors.textTertiary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(item.value.usd)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Text("\(item.borrowable.usd) borrowable")
                            .font(.caption2)
                            .foregroundStyle(GuardianColors.textTertiary)
                    }
                }
                .padding(14)
                .background(GuardianColors.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private func terms(_ line: CreditLine) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent("APR", value: "\(line.apr.oneDecimal)%")
            LabeledContent("Monthly interest", value: line.monthlyInterest.usd)
            LabeledContent("Total collateral", value: line.totalCollateral.usd)
        }
        .font(.subheadline)
        .foregroundStyle(GuardianColors.textSecondary)
        .padding(16)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func healthColour(_ line: CreditLine) -> Color {
        switch line.healthBand {
        case .safe:    GuardianColors.positive
        case .caution: GuardianColors.warning
        case .atRisk:  GuardianColors.negative
        case nil:      GuardianColors.textSecondary
        }
    }
}
