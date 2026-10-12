//
//  CardDesign.swift
//
//  The three FurlPay card designs: the ones on furlpay.com/telegram, which the
//  server names as themes (apps/web cardLifecycle.ts CARD_THEMES), the Expo app
//  draws from native-app/lib/cards/designs.ts and Wear OS from CardDesign.kt.
//  Colours are RRGGBB and lifted from the same stylesheet, so every surface
//  draws the same card.
//
//  Foundation only. This file is compiled into the widget and watch targets as
//  well, and none of them need SwiftUI to know which card is which.
//

import Foundation

public enum CardDesign: String, CaseIterable, Sendable {
    case electric, world, pearl

    public var displayName: String {
        switch self {
        case .electric: return "Electric"
        case .world: return "World"
        case .pearl: return "Pearl"
        }
    }

    /// Background stops, top-leading to bottom-trailing.
    public var colors: [UInt32] {
        switch self {
        case .electric: return [0x14197D, 0x1C24C5, 0x006BFF, 0x004CEA]
        case .world: return [0x060B21, 0x081432, 0x0B2A6B]
        case .pearl: return [0xF1F0FF, 0xB8CBFF, 0xC7A7F8]
        }
    }

    /// Text and mark colour that stays readable on `colors`.
    public var ink: UInt32 { self == .pearl ? 0x353E6E : 0xFFFFFF }

    public var border: UInt32 {
        switch self {
        case .electric: return 0x5155EB
        case .world: return 0x4583D1
        case .pearl: return 0xE7E4FF
        }
    }

    /// Pearl is the one light card; the magnetic stripe and overlays key off it.
    public var isLight: Bool { self == .pearl }

    /// The design a card wears, from the two-colour gradient `GET /api/cards`
    /// publishes. An older theme, or no gradient at all, is `nil`: the card
    /// keeps its plain treatment rather than being dressed in a guess.
    public init?(gradient: [String]?) {
        guard let gradient, gradient.count == 2 else { return nil }
        switch gradient[0].lowercased() + "|" + gradient[1].lowercased() {
        case "#14197d|#006bff": self = .electric
        case "#060b21|#0b2a6b": self = .world
        case "#f1f0ff|#c7a7f8": self = .pearl
        default: return nil
        }
    }
}

/// What the back of a card prints.
///
/// NO CARD DIGITS ARE CONSTRUCTED ON THE DEVICE. The full number, the expiry
/// and the CVV exist only in the card issuer's vault, and no issuer is
/// connected, so there is no initialiser here that takes them: the only thing
/// this type can produce is masks around the last four the server already
/// sends. Showing real details is a vault integration, not a formatting change.
public struct CardBackFields: Equatable, Sendable {
    public let number: String
    public let expiry: String
    public let cvv: String

    public static func masked(last4: String) -> CardBackFields {
        let isFourDigits = last4.count == 4 && last4.allSatisfy { $0.isASCII && $0.isNumber }
        return CardBackFields(
            number: "•••• •••• •••• " + (isFourDigits ? last4 : "••••"),
            expiry: "••/••",
            cvv: "•••"
        )
    }
}

/// How long the back of a card may stay on screen before it turns away.
public let cardBackVisibleSeconds: TimeInterval = 30
