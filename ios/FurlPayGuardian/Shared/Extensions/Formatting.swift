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
public enum GuardianColors {
    public static let background = Color(red: 0.02, green: 0.02, blue: 0.04)
    public static let surface = Color(red: 0.08, green: 0.08, blue: 0.12)
    public static let surfaceElevated = Color(red: 0.12, green: 0.12, blue: 0.18)

    public static let primaryAccent = Color(red: 0.29, green: 0.56, blue: 1.00)
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
