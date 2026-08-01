//
//  AssetLogo.swift
//
//  Port of wear/ui/AssetLogo.kt.
//
//  The two-letter monogram renders instantly and always; the real mark draws
//  over it when it loads. A row is never blank and never a broken-image box —
//  on a watch, a placeholder that flickers to an error icon is worse than one
//  that simply stays.
//
//  Colour is derived from the symbol rather than fetched, so an unknown asset
//  still gets a stable, distinguishable tile.
//

import SwiftUI

private let origin = "https://furlpay.com"

public struct AssetLogo: View {
    let symbol: String
    let logoPath: String?
    var size: CGFloat = 30

    public init(symbol: String, logoPath: String? = nil, size: CGFloat = 30) {
        self.symbol = symbol
        self.logoPath = logoPath
        self.size = size
    }

    private var url: URL? {
        guard let logoPath, !logoPath.isEmpty else { return nil }
        return URL(string: logoPath.hasPrefix("http") ? logoPath : origin + logoPath)
    }

    public var body: some View {
        ZStack {
            MonogramTile(symbol: symbol, size: size)
            if let url {
                // `AsyncImage`'s default placeholder is an empty view, which is
                // exactly right here — the monogram underneath IS the
                // placeholder. The failure phase is also left empty so a 404
                // degrades to the monogram rather than a broken-image glyph.
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFit()
                    }
                }
                .frame(width: size, height: size)
                .clipShape(.circle)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(symbol)
    }
}

public struct MonogramTile: View {
    let symbol: String
    var size: CGFloat = 30

    private var initials: String {
        String(symbol.prefix(2)).uppercased()
    }

    /// Stable hue from the symbol. Hashing `Symbol.hashValue` would be wrong —
    /// Swift's string hashing is seeded per-process, so the colour would change
    /// between launches.
    private var hue: Double {
        let sum = symbol.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
        return Double(sum % 360) / 360.0
    }

    public init(symbol: String, size: CGFloat = 30) {
        self.symbol = symbol
        self.size = size
    }

    public var body: some View {
        Circle()
            .fill(Color(hue: hue, saturation: 0.45, brightness: 0.55))
            .frame(width: size, height: size)
            .overlay(
                Text(initials)
                    .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .minimumScaleFactor(0.5)
            )
    }
}
