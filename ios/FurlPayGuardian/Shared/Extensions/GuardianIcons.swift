//
//  GuardianIcons.swift
//
//  Port of wear/ui/GuardianIcons.kt.
//
//  The Kotlin hand-draws a whole glyph set on a 24-unit grid because Android
//  has no system icon family that matches the brand and pulling in an icon font
//  was rejected. iOS has SF Symbols — a system family, weight-matched to the
//  text, localised, and free. Redrawing those by hand here would be worse in
//  every dimension.
//
//  So this file is deliberately SMALLER than its Kotlin counterpart. What it
//  keeps is the part SF Symbols cannot supply:
//
//    * `GuardianIcon` — one named mapping, so a screen never hardcodes a symbol
//      string and the set stays consistent.
//    * `FurlPayMark` — the brand mark, which IS drawn by hand because it is the
//      exact apps/web/public/furlpay-mark.svg geometry.
//
//  Brand voice rule carried over verbatim: no emoji anywhere.
//

import SwiftUI

/// Named icons. Screens reference these rather than raw SF Symbol strings, so
/// a symbol that turns out to be wrong or unavailable is changed in one place.
public enum GuardianIcon: String, CaseIterable, Sendable {
    case wallet, cards, portfolio, spending, markets, travel, events
    case voice, receive, settings, alarm, freeze, unfreeze
    case send, receiveArrow, swap, topUp
    case up, down, flat
    case success, failure, warning, pending

    public var systemName: String {
        switch self {
        case .wallet:       "wallet.bifold"
        case .cards:        "creditcard"
        case .portfolio:    "chart.pie"
        case .spending:     "arrow.down.circle"
        case .markets:      "chart.line.uptrend.xyaxis"
        case .travel:       "airplane"
        case .events:       "calendar"
        case .voice:        "mic.fill"
        case .receive:      "qrcode"
        case .settings:     "gearshape"
        case .alarm:        "bell.badge.fill"
        case .freeze:       "snowflake"
        case .unfreeze:     "sun.max"
        case .send:         "arrow.up.right"
        case .receiveArrow: "arrow.down.left"
        case .swap:         "arrow.left.arrow.right"
        case .topUp:        "plus.circle"
        case .up:           "arrow.up.right"
        case .down:         "arrow.down.right"
        case .flat:         "minus"
        case .success:      "checkmark.circle.fill"
        case .failure:      "xmark.circle.fill"
        case .warning:      "exclamationmark.triangle.fill"
        case .pending:      "clock"
        }
    }

    public var image: Image { Image(systemName: systemName) }

    /// Direction glyph for a signed change. Zero gets its own icon rather than
    /// being lumped in with "up" — a flat day is information, not a gain.
    public static func forChange(_ value: Double) -> GuardianIcon {
        if value > 0 { return .up }
        if value < 0 { return .down }
        return .flat
    }
}

/// The FurlPay mark: gradient tile with a white F.
///
/// Hand-drawn because it is brand geometry, not an icon — matching
/// `apps/web/public/furlpay-mark.svg`. Drawn rather than shipped as an asset so
/// it stays crisp at complication sizes and costs no bundle space in three
/// targets.
public struct FurlPayMark: View {
    var size: CGFloat

    public init(size: CGFloat = 28) {
        self.size = size
    }

    public var body: some View {
        // The F, on a 24-unit grid to match the Kotlin. Proportions are the
        // reason this is a Path and not a Text("F") in some font.
        let unit = size / 24

        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.29, green: 0.56, blue: 1.00),
                        Color(red: 0.42, green: 0.35, blue: 0.98),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: size, height: size)
            .overlay {
                Path { path in
                    path.move(to: CGPoint(x: 8 * unit, y: 6 * unit))
                    path.addLine(to: CGPoint(x: 17 * unit, y: 6 * unit))
                    path.addLine(to: CGPoint(x: 17 * unit, y: 9 * unit))
                    path.addLine(to: CGPoint(x: 11 * unit, y: 9 * unit))
                    path.addLine(to: CGPoint(x: 11 * unit, y: 13 * unit))
                    path.addLine(to: CGPoint(x: 16 * unit, y: 13 * unit))
                    path.addLine(to: CGPoint(x: 16 * unit, y: 16 * unit))
                    path.addLine(to: CGPoint(x: 11 * unit, y: 16 * unit))
                    path.addLine(to: CGPoint(x: 11 * unit, y: 19 * unit))
                    path.addLine(to: CGPoint(x: 8 * unit, y: 19 * unit))
                    path.closeSubpath()
                }
                .fill(.white)
            }
            .accessibilityLabel("FurlPay")
    }
}
