//
//  HotelMapMarkerViews.swift
//
//  The markers, and the motion they move with.
//
//  SIZE AND COLOUR BOTH CARRY MEANING — size is how many properties, colour is
//  which band that count falls in — and both come from one table in
//  HotelMapStyle so they can never disagree. Everything here is presentation;
//  no view decides what a marker means.
//
//  MOTION IS A CONFIRMATION, NOT DECORATION. A tap target this small on a map
//  that also pans needs to tell the user the tap landed on the marker rather
//  than on the map behind it. That is what the scale and the ring are for, and
//  it is why they are quick: 180ms with a light spring reads as a response,
//  while anything slower reads as an animation the user is waiting out.
//

import SwiftUI

// MARK: - Haptics

/// One generator per event, prepared before use.
///
/// `prepare()` matters more than it looks: without it the Taptic Engine spins
/// up on the first trigger and the feedback lands 50–100ms after the tap, which
/// reads as lag rather than as confirmation. Preparing on appear moves that cost
/// off the interaction.
@MainActor
enum HotelMapHaptics {
    private static let selection = UIImpactFeedbackGenerator(style: .light)
    private static let expand = UIImpactFeedbackGenerator(style: .medium)

    static func prepare() {
        selection.prepare()
        expand.prepare()
    }

    /// A marker was tapped and something opened.
    static func tapped() {
        selection.impactOccurred()
        selection.prepare()
    }

    /// A cluster was expanded — a bigger change of state, so a firmer tick.
    static func expanded() {
        expand.impactOccurred()
        expand.prepare()
    }
}

// MARK: - Cluster

struct ClusterMarkerView: View {
    let cluster: MapCluster
    let isSelected: Bool

    private var band: HotelMapBand { HotelMapStyle.band(for: cluster.count) }

    /// A long count must not reflow the circle: the circle's size is the density
    /// signal and is tied to the band, never to the number of digits.
    private var fontSize: CGFloat {
        switch cluster.count {
        case 1000...: 12
        case 100...: 13
        default: 15
        }
    }

    var body: some View {
        ZStack {
            // The selection ring sits OUTSIDE the circle so the circle's drawn
            // diameter still means what the band says it means.
            if isSelected {
                Circle()
                    .stroke(TripsPalette.green, lineWidth: 3)
                    .frame(width: band.diameter + 12, height: band.diameter + 12)
                    .opacity(0.9)
            }

            Circle()
                .fill(band.fill)
                .overlay(Circle().stroke(.white.opacity(0.9), lineWidth: 2.5))
                .frame(width: band.diameter, height: band.diameter)
                .shadow(color: .black.opacity(0.28), radius: 5, y: 2)

            Text(cluster.count.formatted())
                .font(.system(size: fontSize, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(band.text)
                // A four-digit count in a 40pt circle would otherwise clip.
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .frame(width: band.diameter - 6)
        }
        .scaleEffect(isSelected ? 1.12 : 1)
        .animation(.spring(response: 0.28, dampingFraction: 0.7), value: isSelected)
        // One label rather than three: VoiceOver should read this as a single
        // summary, not as a circle, a number and a ring.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(cluster.label), \(cluster.count) luxury \(cluster.count == 1 ? "property" : "properties")"
        )
        .accessibilityHint("Opens the area summary")
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Property

struct PropertyMarkerView: View {
    let point: MapPoint
    let isSelected: Bool

    private var isCurated: Bool { point.isCurated }
    private var confirmed: Bool { point.isConfirmed }
    private var diameter: CGFloat {
        isCurated ? HotelMapStyle.propertyDiameter : HotelMapStyle.osmDiameter
    }
    private var fill: Color {
        isCurated ? HotelMapStyle.categoryColor(for: point.categories) : .white
    }

    var body: some View {
        ZStack {
            if isSelected {
                Circle()
                    .stroke(TripsPalette.green, lineWidth: 3)
                    .frame(width: diameter + 12, height: diameter + 12)
                    .opacity(0.9)
            }

            Circle()
                .fill(fill.opacity(HotelMapStyle.fillOpacity(confirmed: confirmed)))
                .overlay(
                    Circle().stroke(
                        isCurated
                            ? .white.opacity(HotelMapStyle.ringOpacity(confirmed: confirmed))
                            : Color(hexRGB: 0x94_A3B8),
                        // An unconfirmed position is drawn DIFFERENTLY rather
                        // than hidden: the property is real, and what is unknown
                        // is exactly which building. A dashed ring says so.
                        style: StrokeStyle(
                            lineWidth: 2.5,
                            dash: isCurated && !confirmed ? [3, 3] : []
                        )
                    )
                )
                .frame(width: diameter, height: diameter)
                .shadow(color: .black.opacity(0.28), radius: 4, y: 2)

            if isCurated, let stars = point.stars {
                Text("\(stars)")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
        }
        .scaleEffect(isSelected ? 1.14 : 1)
        .animation(.spring(response: 0.28, dampingFraction: 0.7), value: isSelected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens this property")
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityText: String {
        var parts = [point.name]
        if !point.city.isEmpty { parts.append(point.city) }
        if let stars = point.stars { parts.append("\(stars) star") }
        if isCurated && !confirmed { parts.append("approximate position") }
        if !isCurated { parts.append("from OpenStreetMap") }
        return parts.joined(separator: ", ")
    }
}
