//
//  Formatting.swift
//
//  Shared formatters. Centralised because a balance rendered "$12,847.32" on the
//  phone and "$12847.32" on the watch reads as two different numbers to a user
//  glancing between them.
//

import Foundation
import SwiftUI

public extension Decimal {
    var doubleValue: Double { NSDecimalNumber(decimal: self).doubleValue }

    /// Full precision — phone screens, detail rows, confirmation cards.
    var usd: String {
        doubleValue.formatted(.currency(code: "USD"))
    }

    /// Abbreviated — watch faces and complications, where "$12.8K" fits and
    /// "$12,847.32" does not.
    var usdCompact: String {
        let value = doubleValue
        let sign = value < 0 ? "-" : ""
        let magnitude = abs(value)
        return switch magnitude {
        case 1_000_000...:
            "\(sign)$\((magnitude / 1_000_000).formatted(.number.precision(.fractionLength(1))))M"
        case 10_000...:
            "\(sign)$\((magnitude / 1_000).formatted(.number.precision(.fractionLength(1))))K"
        default:
            value.formatted(.currency(code: "USD").precision(.fractionLength(2)))
        }
    }

    /// Crypto quantities need more places than money; trailing zeros are noise.
    var quantity: String {
        doubleValue.formatted(.number.precision(.fractionLength(0...8)))
    }
}

public extension Double {
    /// "4.2" — for rates and percentages where the sign is not the point.
    /// Separate from `signedPercent`, which always shows + or −.
    var oneDecimal: String { String(format: "%.1f", self) }

    /// "1.84" — health factors and ratios, where the second digit is the
    /// difference between comfortable and about to be liquidated.
    var twoDecimals: String { String(format: "%.2f", self) }

    /// Always signed — a change of "+2.4%" and "2.4%" look identical at a glance
    /// on a watch, and only one of them tells the user the direction.
    var signedPercent: String {
        let sign = self >= 0 ? "+" : ""
        return "\(sign)\(formatted(.number.precision(.fractionLength(2))))%"
    }
}

public extension Date {
    /// "in 24 days", "2 hours ago" — how the Wear OS Home screen states the next
    /// event, and how a reminder row states its due time.
    var relativeDescription: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: self, relativeTo: Date())
    }

    var shortTime: String {
        formatted(date: .omitted, time: .shortened)
    }

    var dayAndMonth: String {
        formatted(.dateTime.day().month(.abbreviated))
    }

    /// Greeting used by both Home screens, so they never disagree.
    static var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 0..<12: "Good morning"
        case 12..<17: "Good afternoon"
        case 17..<22: "Good evening"
        default: "Good night"
        }
    }
}

// MARK: - Theme

/// AMOLED-first palette, matching the Wear OS theme. Pure black is deliberate:
/// on an OLED watch face an unlit pixel draws no power, and the Guardian screens
/// are mostly background.
///
/// "Matching the Wear OS theme" was not true of the accent: this shipped Dodger
/// Blue while `GuardianTheme.kt` used emerald, so the two halves of the same
/// companion product — a phone app and the watch app it pairs with — drew their
/// primary buttons in different colours. The accent below is now
/// FurlPayColors.Primary from the Wear theme, value for value.
///
/// The wider palette split is NOT resolved here and is deliberate to leave
/// alone: the web tokens (`packages/ui/src/tokens.ts`) lead with red #FF3B30
/// and the React Native app with mint #00E599. Picking one across all four
/// surfaces is a brand decision, not a bug fix.
public enum GuardianColors {
    public static let background = Color(red: 0.02, green: 0.02, blue: 0.04)
    public static let surface = Color(red: 0.08, green: 0.08, blue: 0.12)
    public static let surfaceElevated = Color(red: 0.12, green: 0.12, blue: 0.18)

    /// Emerald #5CE5A6 — the same value as FurlPayColors.Primary in
    /// guardian/app/wear/.../theme/GuardianTheme.kt.
    public static let primaryAccent = Color(red: 0.361, green: 0.898, blue: 0.651)

    /// What goes ON [primaryAccent]. Deep green #04291B, the Wear theme's
    /// OnPrimary.
    ///
    /// This pair is not optional. The old accent was a mid-blue that white text
    /// sat on legibly; emerald is a LIGHT colour, and white on it lands around
    /// 1.6:1 — far under the 4.5:1 body-text floor and unreadable in sunlight,
    /// which is exactly when someone is holding up a payment screen. Every call
    /// site that fills with primaryAccent must take its foreground from here
    /// rather than hardcoding .white.
    public static let onPrimaryAccent = Color(red: 0.016, green: 0.161, blue: 0.106)
    public static let positive = Color(red: 0.20, green: 0.78, blue: 0.35)
    public static let negative = Color(red: 0.96, green: 0.26, blue: 0.21)
    public static let warning = Color(red: 1.00, green: 0.76, blue: 0.03)

    public static let textPrimary = Color.white
    public static let textSecondary = Color.white.opacity(0.6)
    public static let textTertiary = Color.white.opacity(0.35)

    /// One place that decides what green and red mean, so a negative number is
    /// never accidentally rendered in the positive colour.
    public static func forChange(_ value: Double) -> Color {
        value >= 0 ? positive : negative
    }
}


// MARK: - Prominent buttons

public extension View {
    /// A filled brand-accent button whose label colour is PINNED, not inherited.
    ///
    /// Every prominent button in the app used to be
    /// `.buttonStyle(.borderedProminent).tint(GuardianColors.primaryAccent)`,
    /// leaving the label colour to SwiftUI. Whether `.borderedProminent` derives
    /// a contrasting label from the tint's luminance, or just uses white, has
    /// varied by OS version and is not something the source can answer — and
    /// with a light accent the two answers are 9.9:1 and 1.6:1. Guessing right
    /// on today's SDK is not the same as being right, so the foreground is
    /// stated here instead of inferred.
    ///
    /// The modifier order is what the call sites already had, plus the
    /// foreground, so nothing about the geometry changes.
    func guardianProminentButton() -> some View {
        buttonStyle(.borderedProminent)
            .tint(GuardianColors.primaryAccent)
            .foregroundStyle(GuardianColors.onPrimaryAccent)
    }
}
