//
//  TravelDetailScreens.swift
//
//  Ports of native-app/app/travel/{hotels,property/[id],trip/[id]}.tsx.
//  The search-and-book flow already lives in TravelView; these are the depth it
//  was missing.
//
//  The booking idempotency key is generated ONCE per attempt and deliberately
//  NOT regenerated on retry — the same rule TravelView follows and the same one
//  the Wear OS build documents. Minting a fresh key per attempt defeats the
//  mechanism and turns one hotel booking into two.
//

import SwiftUI

// MARK: - Hotels

struct HotelsView: View {
    @Environment(ServiceContainer.self) private var container

    @State private var destination = ""
    @State private var checkIn = Date().addingTimeInterval(7 * 86_400)
    @State private var checkOut = Date().addingTimeInterval(10 * 86_400)
    @State private var results: [HotelOffer] = []
    @State private var searching = false
    @State private var error: String?

    var body: some View {
        List {
            Section("Search") {
                TextField("City or hotel", text: $destination)
                DatePicker("Check in", selection: $checkIn, displayedComponents: .date)
                DatePicker("Check out", selection: $checkOut, in: checkIn..., displayedComponents: .date)
                Button {
                    search()
                } label: {
                    if searching {
                        HStack { ProgressView().controlSize(.small); Text("Searching…") }
                    } else {
                        Text("Search")
                    }
                }
                .disabled(destination.trimmingCharacters(in: .whitespaces).isEmpty || searching)
            }
            .listRowBackground(GuardianColors.surface)

            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(GuardianColors.negative) }
                    .listRowBackground(GuardianColors.surface)
            }

            if !results.isEmpty {
                Section("\(results.count) stays") {
                    ForEach(results) { offer in
                        NavigationLink { PropertyView(offer: offer) } label: {
                            HotelRow(offer: offer)
                        }
                    }
                }
                .listRowBackground(GuardianColors.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Hotels")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func search() {
        searching = true
        error = nil
        Task {
            do {
                results = try await container.api.searchHotels(
                    destination: destination, checkIn: checkIn, checkOut: checkOut
                )
                if results.isEmpty { error = "No stays found for those dates." }
            } catch {
                self.error = "Couldn't search right now."
            }
            searching = false
        }
    }
}

struct HotelRow: View {
    let offer: HotelOffer

    var body: some View {
        HStack(spacing: 12) {
            AssetLogo(symbol: offer.name, logoPath: offer.imageUrl, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(offer.name)
                    .font(.subheadline)
                    .foregroundStyle(GuardianColors.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    if let rating = offer.rating {
                        Label(rating.oneDecimal, systemImage: "star.fill")
                            .foregroundStyle(GuardianColors.warning)
                    }
                    if let city = offer.city { Text("· \(city)") }
                }
                .font(.caption2)
                .foregroundStyle(GuardianColors.textTertiary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(offer.totalUsd.usd)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(GuardianColors.textPrimary)
                Text("total")
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.textTertiary)
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Property

struct PropertyView: View {
    @Environment(ServiceContainer.self) private var container
    let offer: HotelOffer

    @State private var booking = false
    @State private var booked: TravelBooking?
    @State private var error: String?
    /// Once per attempt, held across retries. See the file header.
    @State private var idempotencyKey = UUID().uuidString

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                AssetLogo(symbol: offer.name, logoPath: offer.imageUrl, size: 72)

                VStack(alignment: .leading, spacing: 4) {
                    Text(offer.name)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(GuardianColors.textPrimary)
                    if let address = offer.address {
                        Text(address)
                            .font(.subheadline)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                }

                if !offer.amenities.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Amenities").sectionTitle()
                        Text(offer.amenities.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Price").sectionTitle()
                    Text(offer.totalUsd.usd)
                        .font(.system(size: 30, weight: .semibold, design: .rounded))
                        .foregroundStyle(GuardianColors.textPrimary)
                    if let nights = offer.nights {
                        Text("\(nights) night\(nights == 1 ? "" : "s"), taxes included")
                            .font(.caption)
                            .foregroundStyle(GuardianColors.textTertiary)
                    }
                }

                if let booked {
                    Label("Booked · \(booked.destination)", systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.positive)
                } else {
                    Button {
                        book()
                    } label: {
                        HStack {
                            Spacer()
                            if booking { ProgressView().tint(.white) } else { Text("Book \(offer.totalUsd.usd)") }
                            Spacer()
                        }
                        .padding(.vertical, 14)
                    }
                    .background(GuardianColors.primaryAccent)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                if let error {
                    Text(error).font(.footnote).foregroundStyle(GuardianColors.negative)
                }
            }
            .padding(20)
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Stay")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func book() {
        booking = true
        error = nil
        Task {
            guard await container.biometrics.authenticate(
                reason: "Book \(offer.name) for \(offer.totalUsd.usd)"
            ).isAuthenticated else {
                booking = false
                error = "Not confirmed."
                return
            }
            do {
                booked = try await container.travel.book(
                    offerId: offer.id, idempotencyKey: idempotencyKey
                )
            } catch {
                self.error = "That booking couldn't be completed."
            }
            booking = false
        }
    }
}

// MARK: - Trip detail

struct TripDetailView: View {
    let trip: TravelBooking

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(trip.destination)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(GuardianColors.textPrimary)
                    Text("\(trip.startDate.dayAndMonth) – \(trip.endDate.dayAndMonth)")
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)
                    Text(trip.status.rawValue.capitalized)
                        .font(.caption)
                        .foregroundStyle(trip.isActive ? GuardianColors.positive : GuardianColors.textTertiary)
                }
                .padding(.vertical, 4)
            }
            .listRowBackground(GuardianColors.surface)

            if let flights = trip.flights, !flights.isEmpty {
                Section("Flights") {
                    ForEach(flights) { segment in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(segment.carrier)\(segment.flightNumber)")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(GuardianColors.textPrimary)
                            Text("\(segment.origin) → \(segment.destination)")
                                .font(.caption)
                                .foregroundStyle(GuardianColors.textSecondary)
                            Text("\(segment.departsAt.dayAndMonth) \(segment.departsAt.shortTime) – \(segment.arrivesAt.shortTime)")
                                .font(.caption2)
                                .foregroundStyle(GuardianColors.textTertiary)
                        }
                    }
                }
                .listRowBackground(GuardianColors.surface)
            }

            if let hotel = trip.hotel {
                Section("Stay") {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(hotel.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Text(hotel.city)
                            .font(.caption)
                            .foregroundStyle(GuardianColors.textSecondary)
                        Text("Check in \(hotel.checkIn.dayAndMonth) · out \(hotel.checkOut.dayAndMonth)")
                            .font(.caption2)
                            .foregroundStyle(GuardianColors.textTertiary)
                    }
                }
                .listRowBackground(GuardianColors.surface)
            }
        }
        .scrollContentBackground(.hidden)
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Trip")
        .navigationBarTitleDisplayMode(.inline)
    }
}
