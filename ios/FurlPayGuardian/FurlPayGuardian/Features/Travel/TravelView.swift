//
//  TravelView.swift
//
//  Trips, live flights, flash deals, and booking.
//
//  The idempotency key is generated ONCE when the user opens the confirmation
//  sheet and reused for every retry of that same intent. Minting it per attempt
//  would make the header decorative and let a timeout-then-retry double-charge.
//

import SwiftUI

struct TravelView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var booking: TravelDeal?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // A flight in progress outranks everything else on this screen,
                // so the pass is pinned above the stays rather than filed under
                // them. Absent when nothing is booked — never a placeholder.
                if let pass = container.travel.activePass() {
                    NavigationLink { BoardingPassView() } label: {
                        BoardingPassRow(pass: pass)
                    }
                    .buttonStyle(.plain)
                }

                // The other way in. Search needs a destination already in mind;
                // the map is for finding one, which is the more common of the
                // two — so it sits above the trips rather than under them.
                NavigationLink { HotelMapView() } label: { ExploreMapCard() }
                    .buttonStyle(.plain)

                if !container.travel.activeTrips.isEmpty {
                    Text("Your Trips").sectionTitle()
                    ForEach(container.travel.activeTrips) { trip in
                        TripCard(trip: trip)
                    }
                }

                if !container.travel.deals.isEmpty {
                    Text("Flash Deals").sectionTitle()
                    ForEach(container.travel.deals) { deal in
                        Button { booking = deal } label: { DealCard(deal: deal) }
                            .buttonStyle(.plain)
                    }
                }

                if container.travel.activeTrips.isEmpty && container.travel.deals.isEmpty {
                    Text("Nothing booked, and no deals right now.")
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 60)
                }
            }
            .padding(20)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Travel")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await container.travel.refresh() }
        .sheet(item: $booking) { deal in
            BookingConfirmView(deal: deal)
        }
    }
}

struct TripCard: View {
    let trip: TravelBooking

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(trip.destination)
                    .font(.headline)
                    .foregroundStyle(GuardianColors.textPrimary)
                Spacer()
                Text(trip.status.rawValue.capitalized)
                    .font(.caption2.weight(.medium))
                    .padding(.horizontal, 8)
                    .frame(height: 22)
                    .background(GuardianColors.positive.opacity(0.16))
                    .foregroundStyle(GuardianColors.positive)
                    .clipShape(Capsule())
            }

            Text("\(trip.startDate.dayAndMonth) – \(trip.endDate.dayAndMonth)")
                .font(.caption)
                .foregroundStyle(GuardianColors.textSecondary)

            ForEach(trip.flights ?? []) { flight in
                HStack(spacing: 8) {
                    Image(systemName: "airplane")
                        .font(.caption2)
                        .foregroundStyle(GuardianColors.primaryAccent)
                    Text("\(flight.carrier)\(flight.flightNumber)")
                        .font(.caption.monospaced())
                    Text("\(flight.origin) → \(flight.destination)")
                        .font(.caption)
                    Spacer()
                    Text(flight.departsAt.shortTime)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(GuardianColors.textSecondary)
                }
                .foregroundStyle(GuardianColors.textPrimary)
            }
        }
        .padding(16)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct DealCard: View {
    let deal: TravelDeal

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(deal.destination)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(GuardianColors.textPrimary)
                if let expires = deal.expiresAt {
                    Text("Ends \(expires.relativeDescription)")
                        .font(.caption2)
                        .foregroundStyle(GuardianColors.warning)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(deal.price.usd)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(GuardianColors.textPrimary)
                if let original = deal.originalPrice, let off = deal.discountPercent {
                    Text(original.usd)
                        .font(.caption2)
                        .strikethrough()
                        .foregroundStyle(GuardianColors.textTertiary)
                    Text("-\(off)%")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(GuardianColors.positive)
                }
            }
        }
        .padding(16)
        .background(GuardianColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct BookingConfirmView: View {
    let deal: TravelDeal

    @Environment(ServiceContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    /// Generated once, when the sheet is constructed. Every retry below reuses
    /// this exact value — that is the whole point of the key.
    @State private var idempotencyKey = UUID().uuidString
    @State private var isBooking = false
    @State private var error: String?
    @State private var booked: TravelBooking?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let booked {
                    VStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 46))
                            .foregroundStyle(GuardianColors.positive)
                        Text("Booked")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Text(booked.destination)
                            .font(.subheadline)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                } else {
                    VStack(spacing: 8) {
                        Text(deal.destination)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Text(deal.price.usd)
                            .font(.system(size: 34, weight: .semibold, design: .rounded))
                            .foregroundStyle(GuardianColors.textPrimary)
                    }

                    Text("Face ID confirms before anything is charged.")
                        .font(.caption)
                        .foregroundStyle(GuardianColors.textTertiary)

                    Button {
                        Task { await book() }
                    } label: {
                        ZStack {
                            if isBooking { ProgressView().tint(GuardianColors.onPrimaryAccent) }
                            else { Text("Confirm Booking").font(.headline) }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(GuardianColors.primaryAccent)
                        .foregroundStyle(GuardianColors.onPrimaryAccent)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .disabled(isBooking)
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(GuardianColors.negative)
                        .multilineTextAlignment(.center)
                }

                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(GuardianColors.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(booked == nil ? "Cancel" : "Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func book() async {
        error = nil
        let result = await container.biometrics.authenticate(
            reason: "Confirm booking \(deal.destination) for \(deal.price.usd)"
        )
        guard result.isAuthenticated else {
            if case .unavailable(let why) = result { error = why }
            return
        }

        isBooking = true
        defer { isBooking = false }
        do {
            booked = try await container.travel.book(
                offerId: deal.id, idempotencyKey: idempotencyKey
            )
            await container.sync.pushAllSnapshots(from: container)
        } catch {
            // The key is deliberately NOT regenerated here. If this failed after
            // the server had already charged, retrying with the same key returns
            // the original booking instead of making a second one.
            self.error = error.localizedDescription
        }
    }
}

/// Compact summary of the flight in progress, linking to the full pass.
struct BoardingPassRow: View {
    let pass: BoardingPass

    var body: some View {
        HStack(spacing: 12) {
            FurlPayMark(size: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(pass.flight.originCode) → \(pass.flight.destinationCode)")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text("\(pass.flight.number) · Gate \(pass.flight.gate) · Seat \(pass.flight.seat)")
                    .font(.caption)
                    .foregroundStyle(TripsPalette.subText)
                Text(pass.statusLine())
                    .font(.caption.weight(.medium))
                    .foregroundStyle(TripsPalette.green)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(GuardianColors.textTertiary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [TripsPalette.liveTop, TripsPalette.liveBottom],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 20, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Boarding pass for \(pass.flight.number), \(pass.routeSummary). \(pass.statusLine()). Opens your boarding pass.")
    }
}
