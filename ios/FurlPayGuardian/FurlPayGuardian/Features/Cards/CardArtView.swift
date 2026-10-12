//
//  CardArtView.swift
//
//  The card as an object: front, back, and the turn between them.
//
//  A card wearing one of the three FurlPay designs (CardDesign) is drawn with
//  that artwork; any other card gets the app's plain surface, so nothing is
//  dressed in a design the server did not give it.
//
//  THE BACK IS GATED AND IT TURNS ITSELF AWAY. Seeing it takes Face ID, Touch
//  ID or the passcode, and it flips to the front again after
//  `cardBackVisibleSeconds` or the moment the app leaves the foreground.
//
//  WHAT THE BACK SHOWS TODAY: masks. Full number, expiry and CVV live only in
//  the card issuer's vault, and no issuer is connected. `CardBackFields` can
//  only produce masks, so this view cannot show a digit it was not given.
//

import SwiftUI

// MARK: - Palette

private struct CardPalette {
    let colors: [Color]
    let ink: Color
    let border: Color
    let stripe: Color
    let showsGlobe: Bool

    init(design: CardDesign?) {
        if let design {
            colors = design.colors.map { Color(hexRGB: $0) }
            ink = Color(hexRGB: design.ink)
            border = Color(hexRGB: design.border)
            stripe = design.isLight ? Color(hexRGB: 0x1B2040) : Color(hexRGB: 0x02040C)
            showsGlobe = design == .world
        } else {
            colors = [GuardianColors.surfaceElevated, GuardianColors.surface]
            ink = GuardianColors.textPrimary
            border = GuardianColors.textTertiary.opacity(0.35)
            stripe = Color(hexRGB: 0x02040C)
            showsGlobe = false
        }
    }
}

private let cardShape = RoundedRectangle(cornerRadius: 18, style: .continuous)

private struct CardSurface<Content: View>: View {
    let palette: CardPalette
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity)
            .aspectRatio(1.586, contentMode: .fit)
            .background {
                ZStack {
                    LinearGradient(colors: palette.colors, startPoint: .topLeading, endPoint: .bottomTrailing)
                    if palette.showsGlobe {
                        Image("CardGlobe")
                            .resizable()
                            .scaledToFill()
                            .accessibilityHidden(true)
                    }
                }
            }
            .clipShape(cardShape)
            .overlay(cardShape.strokeBorder(palette.border, lineWidth: 1))
    }
}

private func networkName(_ network: CardNetwork) -> String {
    switch network {
    case .visa: return "VISA"
    case .mastercard: return "MASTERCARD"
    case .unknown: return ""
    }
}

// MARK: - Front

struct CardFrontView: View {
    let card: Card

    var body: some View {
        let palette = CardPalette(design: card.design)
        CardSurface(palette: palette) {
            VStack(alignment: .leading) {
                HStack(alignment: .center, spacing: 8) {
                    FurlPayMark(size: 22, tint: palette.ink)
                    Text("FurlPay")
                        .font(.title3.weight(.bold))
                    Spacer()
                    Image(systemName: "wave.3.right")
                        .font(.title3)
                        .accessibilityHidden(true)
                }
                Spacer()
                Text(card.label)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(card.kind == .physical ? "PHYSICAL" : "VIRTUAL")
                    .font(.caption2.weight(.medium))
                    .opacity(0.72)
                Spacer()
                HStack {
                    Text("•••• \(card.last4)")
                        .font(.body.weight(.bold).monospacedDigit())
                    Spacer()
                    Text(networkName(card.network))
                        .font(.subheadline.weight(.heavy).italic())
                }
            }
            .foregroundStyle(palette.ink)
            .padding(18)
        }
        .overlay {
            if card.frozen {
                cardShape.fill(.black.opacity(0.55))
                Label("Frozen", systemImage: "snowflake")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(height: 30)
                    .background(.black.opacity(0.6), in: Capsule())
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(card.label), card ending \(card.last4)\(card.frozen ? ", frozen" : "")")
    }
}

// MARK: - Back

struct CardBackView: View {
    let card: Card

    var body: some View {
        let palette = CardPalette(design: card.design)
        let fields = CardBackFields.masked(last4: card.last4)
        CardSurface(palette: palette) {
            VStack(spacing: 0) {
                palette.stripe
                    .frame(height: 38)
                    .padding(.top, 20)
                Spacer(minLength: 8)
                HStack(spacing: 0) {
                    Color.white.opacity(0.86)
                    HStack(spacing: 8) {
                        Text("CVV")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color(hexRGB: 0x5A607A))
                        Text(fields.cvv)
                            .font(.subheadline.weight(.bold).italic().monospacedDigit())
                            .foregroundStyle(Color(hexRGB: 0x11142A))
                    }
                    .padding(.horizontal, 10)
                    .frame(maxHeight: .infinity)
                    .background(Color.white)
                }
                .frame(height: 34)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                .padding(.horizontal, 18)
                Spacer(minLength: 8)
                HStack(alignment: .bottom, spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("CARD NUMBER").font(.system(size: 9, weight: .bold)).opacity(0.72)
                        Text(fields.number)
                            .font(.callout.weight(.bold).monospacedDigit())
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("EXPIRES").font(.system(size: 9, weight: .bold)).opacity(0.72)
                        Text(fields.expiry).font(.callout.weight(.bold).monospacedDigit())
                    }
                }
                .foregroundStyle(palette.ink)
                .padding(.horizontal, 18)
                .padding(.bottom, 16)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Back of card ending \(card.last4). Card number, expiry and security code are hidden."
        )
    }
}

// MARK: - Flip

/// Front and back of one card, with the gate between them.
struct FlippableCardView: View {
    let card: Card
    /// Runs the device-owner check. Returns nil when it passed, or the reason
    /// it could not run at all ("" for a plain cancel).
    let authenticate: (String) async -> String?

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingBack = false
    @State private var message: String?
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                CardFrontView(card: card)
                    .opacity(showingBack ? 0 : 1)
                    .rotation3DEffect(.degrees(showingBack ? 180 : 0), axis: (x: 0, y: 1, z: 0))
                    .accessibilityHidden(showingBack)
                CardBackView(card: card)
                    .opacity(showingBack ? 1 : 0)
                    .rotation3DEffect(.degrees(showingBack ? 0 : -180), axis: (x: 0, y: 1, z: 0))
                    .accessibilityHidden(!showingBack)
            }

            Button(showingBack ? "Turn card over" : "Show card back") {
                if showingBack { turn(toBack: false) } else { Task { await reveal() } }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(GuardianColors.primaryAccent)

            if showingBack {
                Text("Your full card number, expiry and CVV are held by the card issuer's secure vault, which isn't connected yet. This app does not have those details.")
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.textSecondary)
                    .multilineTextAlignment(.center)
            } else if let message, !message.isEmpty {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.negative)
                    .multilineTextAlignment(.center)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { turn(toBack: false) }
        }
        .onDisappear { hideTask?.cancel() }
    }

    private func reveal() async {
        message = await authenticate("Show the back of the card ending \(card.last4)")
        if message == nil { turn(toBack: true) }
    }

    private func turn(toBack: Bool) {
        hideTask?.cancel()
        hideTask = nil
        if reduceMotion {
            showingBack = toBack
        } else {
            withAnimation(.easeInOut(duration: 0.42)) { showingBack = toBack }
        }
        guard toBack else { return }
        hideTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(cardBackVisibleSeconds))
            if !Task.isCancelled { turn(toBack: false) }
        }
    }
}
