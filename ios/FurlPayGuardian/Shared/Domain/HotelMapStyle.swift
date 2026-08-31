//
//  HotelMapStyle.swift
//
//  What a marker looks like, and why.
//
//  SIZE AND COLOUR BOTH CARRY MEANING, and different meaning: size is how many
//  properties a cluster stands for, colour is which band that count falls in.
//  Both are read off ONE table below, so a marker can never be large and green —
//  an invariant the tests pin, because the two are consumed at different call
//  sites and could otherwise drift apart.
//
//  PARITY IS THE POINT. These values are transcribed from
//  apps/web/src/components/travel/map/layers.ts and mirrored again in
//  native-app/lib/hotelMap.ts. Three copies exist because the three codebases
//  share no package; a value that drifts is a map that no longer matches itself
//  across platforms, which nobody notices until two of them are open together.
//  HotelMapTests asserts these against the web's numbers rather than against
//  themselves.
//

import Foundation
import SwiftUI

// MARK: - Hex

public extension Color {
    /// A colour from `RRGGBB`. Kept here rather than as a general extension
    /// because the only reason this app parses hex at all is cross-platform
    /// palette parity — everything else uses `GuardianColors`.
    init(hexRGB: UInt32) {
        self.init(
            red: Double((hexRGB >> 16) & 0xFF) / 255,
            green: Double((hexRGB >> 8) & 0xFF) / 255,
            blue: Double(hexRGB & 0xFF) / 255
        )
    }
}

// MARK: - Cluster bands

/// One row of the band table: a radius and the colours that go with it.
public struct HotelMapBand: Sendable, Equatable {
    /// Circle RADIUS in points, matching the web's `r`. The drawn diameter is
    /// twice this — a distinction worth keeping straight, because the web sets
    /// `circle-radius` while SwiftUI's `.frame` takes a width.
    public let radius: CGFloat
    public let fillHex: UInt32
    public let textHex: UInt32

    public var fill: Color { Color(hexRGB: fillHex) }
    public var text: Color { Color(hexRGB: textHex) }
    public var diameter: CGFloat { radius * 2 }
}

public enum HotelMapStyle {

    /// The band table. Radius and colour come from the same row, always.
    private static let bands: [(max: Int, band: HotelMapBand)] = [
        (5, HotelMapBand(radius: 20, fillHex: 0x8B_CF4A, textHex: 0xFF_FFFF)),
        (15, HotelMapBand(radius: 22, fillHex: 0x8B_CF4A, textHex: 0xFF_FFFF)),
        (50, HotelMapBand(radius: 24, fillHex: 0xF4_C430, textHex: 0x1F_2937)),
        (100, HotelMapBand(radius: 26, fillHex: 0xF9_7316, textHex: 0xFF_FFFF)),
        (.max, HotelMapBand(radius: 28, fillHex: 0xF9_7316, textHex: 0xFF_FFFF)),
    ]

    /// The band for a count. Never returns nil: an unbanded marker would be a
    /// marker with no size.
    public static func band(for count: Int) -> HotelMapBand {
        bands.first { count <= $0.max }?.band ?? bands[bands.count - 1].band
    }

    // MARK: - Category colours

    /// The luxury collections, IN THE ORDER THE FILTER PILLS RENDER.
    ///
    /// Order is load-bearing: a property in several collections takes the colour
    /// of the earliest one, so reordering this silently recolours the map.
    public static let categories: [(id: String, title: String, hex: UInt32)] = [
        ("ultra_luxury", "5-star Ultra Luxury", 0xB8_860B),
        ("boutique", "Boutique Design", 0x8B_5CF6),
        ("overwater_villas", "Island & Overwater", 0x0E_7490),
        ("alpine_chalets", "Alpine Chalets", 0x25_63EB),
        ("heritage_castles", "Castles & Palaces", 0x9A_3412),
        ("vineyard_wellness", "Wine & Wellness", 0x1B_7A4E),
        ("executive_suites", "Business Executive", 0x33_4155),
        ("michelin_dining", "Michelin Dining", 0xC2_410C),
        ("helipad_transit", "Helipad & Transit", 0x64_748B),
        ("crypto_escrow", "Pay with USDC", 0x0F_766E),
    ]

    /// Fallback for a property with no recognised collection. Deliberately a
    /// real colour rather than grey — the property exists and belongs on the
    /// map; only its classification is missing.
    public static let defaultCategoryHex: UInt32 = 0x8B_5CF6

    public static func categoryHex(for categories: [String]?) -> UInt32 {
        guard let categories, !categories.isEmpty else { return defaultCategoryHex }
        for entry in Self.categories where categories.contains(entry.id) {
            return entry.hex
        }
        return defaultCategoryHex
    }

    public static func categoryColor(for categories: [String]?) -> Color {
        Color(hexRGB: categoryHex(for: categories))
    }

    public static func categoryTitle(for id: String) -> String? {
        categories.first { $0.id == id }?.title
    }

    // MARK: - Property markers

    /// A curated property's circle. Smaller than any cluster on purpose: at the
    /// zoom where individual properties appear, a pin the size of a cluster
    /// reads as "many" and the map looks busier than it is.
    public static let propertyDiameter: CGFloat = 34
    /// An OpenStreetMap hotel: context, not the subject.
    public static let osmDiameter: CGFloat = 14

    /// Ring opacity for a confirmed vs an approximate position.
    ///
    /// An unconfirmed property is drawn DIFFERENTLY rather than hidden — it is a
    /// real hotel whose exact building a second source could not agree on, and
    /// removing it would hide something true to avoid admitting something
    /// uncertain.
    public static func ringOpacity(confirmed: Bool) -> Double { confirmed ? 0.92 : 0.55 }
    public static func fillOpacity(confirmed: Bool) -> Double { confirmed ? 1.0 : 0.82 }

    // MARK: - Imagery

    /// The best image for a property, or nothing.
    ///
    /// Local file first — the web serves 150 downloaded Commons photographs
    /// under /hotels/… — then the Commons URL. A local path is relative to the
    /// web origin, so a native client has to absolutise it.
    ///
    /// Google Places photography is deliberately absent from the payload
    /// entirely: its policy permits storing the place ID and nothing else.
    public static func imageURL(
        localPath: String?,
        thumbURL: String?,
        fullURL: String?,
        origin: URL
    ) -> URL? {
        if let localPath, !localPath.isEmpty {
            return URL(string: localPath, relativeTo: origin)?.absoluteURL
        }
        if let thumbURL, let url = URL(string: thumbURL) { return url }
        if let fullURL, let url = URL(string: fullURL) { return url }
        return nil
    }
}
