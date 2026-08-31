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
//
//  The brand mark is NOT here — it lives in Shared/UI/FurlPayMark.swift, which
//  is the version the web and Expo apps also ship.
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

// THE FURLPAY MARK USED TO BE DECLARED HERE, and removing it is the fix for a
// build that had been broken since 2026-08-22.
//
// The boarding-pass commit added Shared/UI/FurlPayMark.swift — the green
// two-hook mark matching components/trips/FurlPayLogo.tsx on the web and
// FurlPayMark.tsx in the Expo app — without removing the blue gradient tile
// that lived here. Two `public struct FurlPayMark` in one module is a
// redeclaration, and the Activities target compiles BOTH Shared/Extensions and
// Shared/UI, so it failed first and loudest:
//
//     error: invalid redeclaration of 'FurlPayMark'
//
// The Trips version is the one that survives: every caller is a boarding pass,
// a Live Activity or the Dynamic Island, all drawn against it, and it is the
// version the other two platforms ship.
