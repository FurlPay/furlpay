//
//  HotelMapSheetView.swift
//
//  What a tapped marker opens.
//
//  THE WEB'S HOVER CARD DOES NOT PORT. It is anchored beside a marker, flips at
//  the viewport edges, and stays open while the cursor travels into it — three
//  behaviours built entirely around a pointer that can rest somewhere without
//  committing. A finger is either down or it is not, so the card becomes a
//  sheet and the grace-delay logic simply is not needed here.
//
//  WHAT DOES CARRY OVER is what the content is allowed to claim. The three
//  family counts sum to the cluster's total because the server partitions the
//  taxonomy completely; "confirmed" is how many positions a second source
//  actually agreed with; and there are no nightly prices, because this
//  deployment's Duffel key is a TEST key and a sandbox rate rendered like a real
//  one is indistinguishable from a lie. The layout keeps the slot.
//

import SwiftUI

// MARK: - Shared pieces

/// A photograph, or an honest gap.
private struct MapHeroImage: View {
    let url: URL?
    let tint: Color
    var height: CGFloat = 150

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        placeholder("Photograph unavailable")
                    case .empty:
                        ZStack {
                            tint.opacity(0.12)
                            ProgressView().tint(TripsPalette.green)
                        }
                    @unknown default:
                        placeholder("Photograph unavailable")
                    }
                }
            } else {
                // 356 of the 507 curated properties have no free-licensed
                // photograph, so this is the common case rather than an error.
                placeholder("No photograph available")
            }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func placeholder(_ text: String) -> some View {
        ZStack {
            tint.opacity(0.12)
            Text(text)
                .font(.caption)
                .foregroundStyle(GuardianColors.textTertiary)
        }
    }
}

private struct MapStat: View {
    let symbol: String
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: symbol)
                .font(.system(size: 15))
                .foregroundStyle(GuardianColors.textSecondary)
            Text(value.formatted())
                .font(.system(.callout, design: .rounded).weight(.bold))
                .monospacedDigit()
                .foregroundStyle(GuardianColors.textPrimary)
            Text(label)
                .font(.caption2)
                .foregroundStyle(GuardianColors.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(label)")
    }
}

private struct CategoryBadge: View {
    let id: String

    var body: some View {
        if let title = HotelMapStyle.categoryTitle(for: id) {
            let tint = HotelMapStyle.categoryColor(for: [id])
            Text(title)
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(tint.opacity(0.18), in: Capsule())
                .foregroundStyle(tint)
        }
    }
}

// MARK: - Cluster sheet

struct ClusterSheetView: View {
    let cluster: MapCluster
    let origin: URL
    let onZoomIn: () -> Void
    let onOpenProperty: (ClusterMember) -> Void

    private var hero: ClusterMember? {
        cluster.top.first { imageURL(for: $0) != nil }
    }

    private func imageURL(for member: ClusterMember) -> URL? {
        HotelMapStyle.imageURL(
            localPath: member.imageLocalPath,
            thumbURL: member.imageThumbUrl,
            fullURL: member.imageUrl,
            origin: origin
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(cluster.label)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(GuardianColors.textPrimary)
                    Text(cluster.sublabel)
                        .font(.subheadline)
                        .foregroundStyle(GuardianColors.textSecondary)
                }

                MapHeroImage(
                    url: hero.flatMap(imageURL),
                    tint: TripsPalette.green
                )

                // These three sum to the count, so all four can sit together
                // without the sheet's own arithmetic failing in front of anyone.
                HStack(spacing: 0) {
                    MapStat(symbol: "building.2", value: cluster.families.hotels, label: "Hotels")
                    MapStat(symbol: "beach.umbrella", value: cluster.families.resorts, label: "Resorts")
                    MapStat(symbol: "house", value: cluster.families.villas, label: "Villas")
                    MapStat(symbol: "checkmark.shield", value: cluster.confirmed, label: "Confirmed")
                }
                .padding(.vertical, 12)
                .overlay(alignment: .top) { Divider().overlay(TripsPalette.tileBorder) }
                .overlay(alignment: .bottom) { Divider().overlay(TripsPalette.tileBorder) }

                if !cluster.top.isEmpty {
                    HStack {
                        Text("Top properties")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(GuardianColors.textPrimary)
                        Spacer()
                        if cluster.count > cluster.top.count {
                            Button(action: onZoomIn) {
                                Label("View all", systemImage: "arrow.right")
                                    .font(.caption.weight(.semibold))
                                    .labelStyle(.titleAndIcon)
                            }
                            .tint(TripsPalette.green)
                            .accessibilityLabel("Zoom to all \(cluster.count) properties")
                        }
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(cluster.top) { member in
                                Button { onOpenProperty(member) } label: {
                                    PropertyTile(member: member, url: imageURL(for: member))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 1)
                    }
                }
            }
            .padding(20)
        }
        .background(GuardianColors.background)
        .presentationDetents([.fraction(0.45), .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(GuardianColors.background)
    }
}

private struct PropertyTile: View {
    let member: ClusterMember
    let url: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            MapHeroImage(
                url: url,
                tint: HotelMapStyle.categoryColor(for: member.categories),
                height: 92
            )
            .frame(width: 128)

            Text(member.name)
                .font(.caption.weight(.semibold))
                .foregroundStyle(GuardianColors.textPrimary)
                .lineLimit(1)

            HStack(spacing: 3) {
                if let stars = member.stars {
                    Image(systemName: "star.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(GuardianColors.warning)
                    Text("\(stars).0")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(GuardianColors.textPrimary)
                }
                Text(member.propertyType)
                    .font(.caption2)
                    .foregroundStyle(GuardianColors.textSecondary)
                    .lineLimit(1)
            }

            // Where a nightly rate would sit. It stays a statement about the
            // position until a live Duffel key makes a real price available.
            Text(member.isConfirmed ? "Position confirmed" : "Approximate position")
                .font(.system(size: 10))
                .foregroundStyle(GuardianColors.textTertiary)
                .lineLimit(1)
        }
        .frame(width: 128)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Property sheet

struct PropertySheetView: View {
    let point: MapPoint
    let origin: URL
    let onBook: () -> Void

    private var imageURL: URL? {
        HotelMapStyle.imageURL(
            localPath: point.imageLocalPath,
            thumbURL: point.imageThumbUrl,
            fullURL: point.imageUrl,
            origin: origin
        )
    }

    private var place: String {
        [point.city, point.country].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    /// Where the pin came from, stated rather than implied.
    private var provenance: String {
        if !point.isCurated { return "From OpenStreetMap" }
        if point.isConfirmed {
            return point.corroboratedByOsm == true
                ? "Position confirmed via Google and OpenStreetMap"
                : "Position confirmed via Google"
        }
        return "Approximate position — not confirmed"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(point.name)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(GuardianColors.textPrimary)
                    if !place.isEmpty {
                        Text(place)
                            .font(.subheadline)
                            .foregroundStyle(GuardianColors.textSecondary)
                    }
                }

                MapHeroImage(
                    url: imageURL,
                    tint: HotelMapStyle.categoryColor(for: point.categories)
                )

                HStack(spacing: 6) {
                    if let stars = point.stars {
                        HStack(spacing: 3) {
                            Image(systemName: "star.fill").font(.system(size: 10))
                            Text("\(stars)").font(.caption.weight(.bold))
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(GuardianColors.warning.opacity(0.18), in: Capsule())
                        .foregroundStyle(GuardianColors.warning)
                    }
                    Text(point.hotelType)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(TripsPalette.tile, in: Capsule())
                        .foregroundStyle(GuardianColors.textSecondary)
                }

                if let categories = point.categories, !categories.isEmpty {
                    FlowRow(spacing: 6) {
                        ForEach(categories, id: \.self) { CategoryBadge(id: $0) }
                    }
                }

                Text(provenance)
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textTertiary)

                Button(action: onBook) {
                    Label("View property", systemImage: "arrow.right")
                        .font(.callout.weight(.bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                }
                .background(TripsPalette.green, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .foregroundStyle(GuardianColors.background)
                .buttonStyle(.plain)
            }
            .padding(20)
        }
        .background(GuardianColors.background)
        .presentationDetents([.fraction(0.45), .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(GuardianColors.background)
    }
}

// MARK: - Layout helper

/// Wrapping row of chips.
///
/// SwiftUI has no wrapping HStack before iOS 16's `Layout`, and this app targets
/// 18, so this is the small explicit version rather than a stack of `HStack`s
/// guessing at line breaks.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
