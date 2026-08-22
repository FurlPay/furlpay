//
//  BoardingPassView.swift
//
//  The FurlPay Trips screen: live flight status, the trip, the pass, and what
//  it cost — the order a traveller needs them in on the day.
//
//  Everything here comes from GET /api/travel/boarding-passes. There is no
//  local fallback pass and no placeholder itinerary: with no flight booked the
//  screen says exactly that.
//
//  The pass itself is LIGHT on a black app, deliberately. A gate scanner reads
//  a dark barcode on a light ground, and inverting it to match the app's theme
//  would trade a working pass for a consistent one. Wallet makes the same call.
//

import SwiftUI
// For `isIdleTimerDisabled` on the gate screen. SwiftUI has no equivalent, and
// relying on UIKit arriving transitively through SwiftUI is not a contract.
import UIKit

struct BoardingPassView: View {
    @Environment(ServiceContainer.self) private var container
    @State private var activity = FlightActivityController()
    @State private var expanded = false
    @State private var now = Date.now

    private var pass: BoardingPass? { container.travel.activePass(at: now) }

    var body: some View {
        ScrollView {
            if let pass {
                VStack(spacing: 16) {
                    LiveActivityCard(pass: pass, now: now)
                    TripBlock(pass: pass, expanded: $expanded)
                    GateActionBar(pass: pass, activity: activity, expanded: $expanded)
                    FlightStatusCard(pass: pass, now: now)
                    PaidWithCard(payment: pass.payment)
                }
                .padding(16)
            } else {
                NoPassView(loading: container.travel.isLoading)
                    .padding(.top, 80)
            }
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Boarding pass")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await container.travel.refresh() }
        .task {
            activity.refresh()
            if container.travel.boardingPasses.isEmpty { await container.travel.refresh() }
        }
        // Drives only the in-app labels. The Lock Screen countdown is a SwiftUI
        // timer bound to a Date and needs no ticking at all — this exists so the
        // card in the app crosses "2 min" to "1 min" while someone is looking at
        // it. An async loop rather than a Combine publisher: nothing else in
        // this app imports Combine, and `.task` already cancels on disappear.
        .task {
            while !Task.isCancelled {
                now = .now
                try? await Task.sleep(for: .seconds(1))
            }
        }
        // The gate is the one field that changes without warning, so every
        // refetch pushes the Live Activity too rather than letting the Lock
        // Screen and the app disagree.
        .onChange(of: container.travel.boardingPasses) { _, passes in
            guard let current = passes.first(where: { $0.id == activity.trackedPassId }) else { return }
            Task { await activity.update(current) }
        }
    }
}

// MARK: - Live activity card

private struct LiveActivityCard: View {
    let pass: BoardingPass
    let now: Date

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            FurlPayMark(size: 34)
                .padding(.top, 16)

            VStack(alignment: .leading, spacing: 7) {
                Text("FurlPay")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(TripsPalette.greenDim)
                HStack(spacing: 7) {
                    Text(pass.flight.originCode)
                    Image(systemName: "arrow.right").font(.system(size: 17, weight: .bold))
                    Text(pass.flight.destinationCode)
                }
                .font(.system(size: 25, weight: .bold))
                .foregroundStyle(.white)
                Text(pass.flight.number)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.9))
                Text(pass.statusLine(at: now))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(TripsPalette.green)
            }

            Spacer(minLength: 0)

            RouteTrack(progress: pass.routeProgress(at: now))
                .frame(width: 96, height: 22)
                .padding(.top, 28)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 14)
        .background(
            LinearGradient(
                colors: [TripsPalette.liveTop, TripsPalette.liveBottom],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 26, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Live flight status. \(pass.flight.number), \(pass.routeSummary). \(pass.statusLine(at: now))"
        )
    }
}

// MARK: - Trip hero + pass

/// Hero and pass travel together: the pass overlaps the photo, so they are one
/// block rather than two cards that happen to be adjacent.
private struct TripBlock: View {
    let pass: BoardingPass
    @Binding var expanded: Bool

    var body: some View {
        VStack(spacing: -16) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 11) {
                    Text(pass.title)
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(pass.routeLabel)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.9))
                }
                .padding(.horizontal, 21)
                .padding(.top, 16)
                .padding(.bottom, 13)

                Image("FurlPayAirwaysA321")
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(height: 132)
                    .clipped()
                    .accessibilityLabel("FurlPay Airways Airbus A321 in flight above the clouds")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [TripsPalette.heroTop, TripsPalette.heroBottom],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))

            BoardingPassCard(pass: pass, expanded: $expanded)
        }
    }
}

private struct BoardingPassCard: View {
    let pass: BoardingPass
    @Binding var expanded: Bool

    private var flight: BoardingPassFlight { pass.flight }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.22)) { expanded.toggle() }
            } label: {
                HStack {
                    Text(flight.number)
                        .font(.system(size: 29, weight: .semibold))
                        .foregroundStyle(TripsPalette.passInk)
                    Spacer()
                    Text(flight.aircraft)
                        .font(.subheadline)
                        .foregroundStyle(Color(red: 0.235, green: 0.235, blue: 0.263))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(TripsPalette.passChip, in: Capsule())
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(expanded ? "Hide" : "Show") full boarding pass for \(flight.number)")

            rule.padding(.top, 13)

            HStack(alignment: .top) {
                PassField(label: "Boarding", value: flight.boardingTime, accent: true)
                Spacer()
                PassField(label: "Departs", value: flight.departureTime)
                Spacer()
                PassField(label: "Gate", value: flight.gate)
                Spacer()
                PassField(label: "Seat", value: flight.seat)
            }
            .padding(.top, 13)

            PassField(label: "Arrives", value: flight.arrivalTime)
                .padding(.top, 13)

            if expanded {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top) {
                        PassField(label: "From", value: "\(flight.originCity) (\(flight.originCode))")
                        Spacer()
                        PassField(label: "To", value: "\(flight.destinationCity) (\(flight.destinationCode))")
                    }
                    HStack(alignment: .top) {
                        PassField(label: "Aircraft", value: flight.aircraft)
                        Spacer()
                        PassField(label: "Boarding gate", value: flight.gate)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(TripsPalette.passInset, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.top, 14)
            }

            rule.padding(.top, 15)

            HStack(alignment: .bottom) {
                PassField(label: "Passenger", value: pass.passenger.name)
                Spacer()
                if pass.passenger.verified {
                    Image(systemName: "checkmark")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(TripsPalette.ink, in: Circle())
                        .accessibilityLabel("Identity verified")
                }
            }
            .padding(.top, 13)

            rule.padding(.top, 13)

            BarcodeStrip(value: pass.id, height: expanded ? 70 : 46)
                .padding(.top, 12)

            Text("FURLPAY")
                .font(.system(size: 10, weight: .bold))
                .kerning(1.2)
                .foregroundStyle(Color(red: 0.235, green: 0.235, blue: 0.263))
                .frame(maxWidth: .infinity)
                .padding(.top, 7)
        }
        .padding(.horizontal, 19)
        .padding(.top, 15)
        .padding(.bottom, 13)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var rule: some View {
        Rectangle().fill(TripsPalette.passRule).frame(height: 1)
    }
}

private struct PassField: View {
    let label: String
    let value: String
    var accent = false

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(TripsPalette.passInkDim)
            Text(value)
                .font(.system(size: 24))
                .foregroundStyle(accent ? TripsPalette.ink : TripsPalette.passInk)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }
}

// MARK: - Actions

/// The reference design labels the wide button "Add to Apple Wallet". Nothing
/// in FurlPay issues a signed .pkpass yet — no pass type identifier, no
/// certificate, no endpoint — so this button does not claim to. It does the two
/// things we can genuinely deliver: put the flight on the Lock Screen, and put
/// the barcode under a scanner. The slot is the design's; when a pass-signing
/// endpoint lands, this is the button that changes.
private struct GateActionBar: View {
    let pass: BoardingPass
    let activity: FlightActivityController
    @Binding var expanded: Bool

    @State private var showingGate = false
    @State private var failure: String?

    private var tracking: Bool { activity.isTracking(pass) }

    var body: some View {
        HStack(spacing: 12) {
            Button {
                if tracking {
                    Task { await activity.stop() }
                } else if !activity.start(pass) {
                    // Surfaced verbatim. ActivityKit declines silently when Live
                    // Activities are off in Settings, so "nothing happened" is
                    // the one outcome this button must never produce.
                    failure = activity.lastError
                }
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: tracking ? "bolt.horizontal.circle.fill" : "lock.iphone")
                        .font(.system(size: 20))
                        .foregroundStyle(.white)
                        .frame(width: 38, height: 30)
                        .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 7))
                    VStack(alignment: .leading, spacing: 0) {
                        Text(tracking ? "Tracking on" : "Track on")
                        Text("Lock Screen")
                    }
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.white)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(Color(red: 0.067, green: 0.090, blue: 0.082), in: Capsule())
            }
            .buttonStyle(.plain)

            Menu {
                Button("Flight details", systemImage: "info.circle") {
                    withAnimation(.snappy(duration: 0.22)) { expanded = true }
                }
                Button("Show at gate", systemImage: "barcode.viewfinder") { showingGate = true }
                ShareLink(item: shareText) { Label("Share pass", systemImage: "square.and.arrow.up") }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color(red: 0.235, green: 0.235, blue: 0.263))
                    .frame(width: 48, height: 48)
                    .background(Color(red: 0.922, green: 0.922, blue: 0.929), in: Circle())
            }
            .accessibilityLabel("More trip options")
        }
        .sheet(isPresented: $showingGate) { GateScreen(pass: pass) }
        .alert(
            "Live Activity",
            isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } }),
            presenting: failure
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { message in
            Text(message)
        }
    }

    private var shareText: String {
        """
        \(pass.flight.number) · \(pass.flight.originCode) → \(pass.flight.destinationCode)
        \(pass.passenger.name) · Seat \(pass.flight.seat) · Gate \(pass.flight.gate)
        Boards \(pass.flight.boardingTime), departs \(pass.flight.departureTime), \
        arrives \(pass.flight.arrivalTime)
        """
    }
}

/// Full-screen pass. White ground, barcode as wide as the display allows, and
/// the screen kept awake: gate scanners want contrast and quiet zones, and a
/// phone that dims mid-scan makes the passenger the problem.
private struct GateScreen: View {
    let pass: BoardingPass
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 14) {
            Text(pass.flight.number)
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(TripsPalette.passInk)
            Text("\(pass.flight.originCode) → \(pass.flight.destinationCode)")
                .font(.body)
                .foregroundStyle(TripsPalette.passInkDim)

            BarcodeStrip(value: pass.id, height: 140)
                .padding(.horizontal, 24)
                .padding(.top, 10)

            Text(pass.id)
                .font(.caption.monospaced())
                .foregroundStyle(TripsPalette.passInkDim)

            HStack(spacing: 36) {
                GateFact(label: "Gate", value: pass.flight.gate)
                GateFact(label: "Seat", value: pass.flight.seat)
                GateFact(label: "Boards", value: pass.flight.boardingTime)
            }
            .padding(.top, 18)

            Text(pass.passenger.name)
                .font(.body)
                .foregroundStyle(TripsPalette.passInk)

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 56)
        .background(Color.white.ignoresSafeArea())
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(TripsPalette.passInk)
                    .padding(16)
            }
        }
        // Without this the display dims to black mid-queue and the passenger is
        // stabbing at the screen while the gate agent waits.
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }
}

private struct GateFact: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(label).font(.footnote).foregroundStyle(TripsPalette.passInkDim)
            Text(value).font(.system(size: 22, weight: .semibold)).foregroundStyle(TripsPalette.passInk)
        }
    }
}

// MARK: - Status + payment

private struct FlightStatusCard: View {
    let pass: BoardingPass
    let now: Date

    private var boardingLabel: String {
        if let minutes = pass.minutesToBoarding(at: now) { return "\(minutes) min" }
        return pass.flight.boardingTime
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 8) {
                    FurlPayMark(size: 22)
                    Text("FurlPay").font(.title3.weight(.semibold)).foregroundStyle(.white)
                }
                Spacer()
                Text("LIVE")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color(red: 0.498, green: 0.906, blue: 0.690))
                    .padding(.horizontal, 13)
                    .padding(.vertical, 5)
                    .background(Color(red: 0.059, green: 0.290, blue: 0.192), in: Capsule())
            }

            Text("\(pass.flight.number) · \(pass.flight.aircraft)")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(.white.opacity(0.95))
                .padding(.top, 12)

            RouteArc(progress: pass.routeProgress(at: now))
                .frame(height: 48)
                .padding(.top, 2)

            HStack {
                Text(pass.flight.originCode)
                Spacer()
                Text(pass.flight.destinationCode)
            }
            .font(.system(size: 24, weight: .semibold))
            .foregroundStyle(.white)

            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 9) {
                    Text(pass.flight.originCity).font(.subheadline).foregroundStyle(TripsPalette.subText)
                    Text(pass.flight.departureTime).font(.system(size: 22, weight: .medium)).foregroundStyle(.white)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 9) {
                    Text(pass.flight.destinationCity).font(.subheadline).foregroundStyle(TripsPalette.subText)
                    Text(pass.flight.arrivalTime).font(.system(size: 22, weight: .medium)).foregroundStyle(.white)
                }
            }
            .padding(.top, 12)

            HStack(spacing: 12) {
                StatusTile(label: "Gate", value: pass.flight.gate)
                StatusTile(label: "Seat", value: pass.flight.seat)
                StatusTile(label: "Boarding", value: boardingLabel).frame(maxWidth: .infinity)
            }
            .padding(.top, 15)

            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Status").font(.subheadline).foregroundStyle(TripsPalette.subText)
                    Text(pass.status(at: now).label)
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(.white)
                }
                Spacer()
                Capsule()
                    .fill(Color(red: 0.071, green: 0.294, blue: 0.200))
                    .frame(width: 54, height: 24)
                    .overlay(alignment: .trailing) {
                        Circle()
                            .fill(Color(red: 0.408, green: 0.906, blue: 0.639))
                            .frame(width: 18, height: 18)
                            .padding(.trailing, 3)
                    }
                    .padding(.bottom, 3)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(TripsPalette.tile, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(TripsPalette.tileBorder, lineWidth: 1)
            )
            .padding(.top, 11)
        }
        .padding(.horizontal, 18)
        .padding(.top, 15)
        .padding(.bottom, 13)
        .background(Color(red: 0.035, green: 0.180, blue: 0.129).opacity(0.5),
                    in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(TripsPalette.cardBorder, lineWidth: 1)
        )
    }
}

private struct StatusTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(label).font(.subheadline).foregroundStyle(TripsPalette.subText)
            Text(value).font(.system(size: 21, weight: .semibold)).foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(TripsPalette.tile, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(TripsPalette.tileBorder, lineWidth: 1)
        )
    }
}

private struct PaidWithCard: View {
    let payment: BoardingPassPayment

    /// "2", not "2.0" — and "2.5" if a rate ever has a half point in it.
    private var rate: String {
        payment.rewardsRate.formatted(.number.precision(.fractionLength(0...1)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(Color(red: 0.129, green: 0.478, blue: 0.278), in: Circle())
                Text("PAID WITH FURLPAY")
                    .font(.system(size: 16, weight: .medium))
                    .kerning(0.7)
                    .foregroundStyle(Color(red: 0.310, green: 0.749, blue: 0.514))
            }

            HStack {
                HStack(spacing: 11) {
                    UsdcCoin(size: 30)
                    Text(payment.currency)
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(.white)
                }
                Spacer()
                Text(payment.amount, format: .currency(code: "USD"))
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white)
            }

            HStack {
                // Two concatenated Texts rather than one interpolated string: it
                // keeps the emphasis on the rate without putting a bare `%`
                // into a LocalizedStringKey, where it reads as a format token.
                (Text(rate).bold().foregroundStyle(TripsPalette.greenBright)
                    + Text("% FurlPay Rewards")
                        .foregroundStyle(Color(red: 0.388, green: 0.780, blue: 0.576)))
                    .font(.system(size: 16))
                Spacer()
                Image(systemName: "sparkles")
                    .foregroundStyle(Color(red: 0.498, green: 0.878, blue: 0.671))
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 19)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(red: 0.043, green: 0.212, blue: 0.153).opacity(0.55),
                    in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(TripsPalette.cardBorder, lineWidth: 1)
        )
    }
}

private struct NoPassView: View {
    let loading: Bool

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "airplane.departure")
                .font(.largeTitle)
                .foregroundStyle(GuardianColors.textTertiary)
            Text(loading ? "Loading your boarding pass…" : "No flight booked")
                .font(.headline)
                .foregroundStyle(GuardianColors.textSecondary)
            if !loading {
                Text("Book a flight and your boarding pass, gate and live status appear here.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(GuardianColors.textTertiary)
                    .padding(.horizontal, 40)
            }
        }
        .frame(maxWidth: .infinity)
    }
}
