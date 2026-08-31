//
//  HotelMapView.swift
//
//  The luxury hotel map, on iPhone.
//
//  SAME DATA AND SAME CLAIMS as furlpay.com/hotels/map and the Android app. It
//  reads the same /api/travel/hotels/map endpoint, which already does the
//  clustering, the OpenStreetMap merge and the honest counting — so nothing here
//  recomputes any of it, and the three surfaces cannot disagree about how many
//  properties are in a place.
//
//  WHY MAPKIT RATHER THAN THE WEB'S TILES. The web draws OpenFreeMap tiles
//  recoloured to a warm ivory palette; matching that here would mean a MapLibre
//  dependency and a second renderer to keep alive. MapKit is already on the
//  device, needs no key, and — more importantly — behaves the way an iPhone user
//  expects a map to behave, down to the rotation gesture and the Look Around
//  affordances. The MARKERS carry the FurlPay design; the cartography is
//  Apple's, and looks deliberately native rather than like a ported web page.
//
//  WHAT CHANGES FOR TOUCH. The web's hover card is anchored beside a marker and
//  survives the cursor travelling into it; neither idea exists on a touch
//  screen. Tapping opens a sheet. Everything else — what a marker's size means,
//  what its colour means, what the status pill may claim — is unchanged, because
//  those are properties of the data rather than of the pointer.
//

import MapKit
import SwiftUI

struct HotelMapView: View {
    @Environment(ServiceContainer.self) private var container

    /// The world, at the first zoom where country labels are legible.
    @State private var camera: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 25, longitude: 20),
            span: MKCoordinateSpan(latitudeDelta: 120, longitudeDelta: 120)
        )
    )

    @State private var clusters: [MapCluster] = []
    @State private var points: [MapPoint] = []
    @State private var counts: MapCounts?
    @State private var dataset: MapDataset?
    @State private var truncated = 0
    @State private var osmFilteredOut = false
    @State private var osmUnavailable = false

    @State private var isLoading = false
    @State private var errorText: String?

    @State private var selectedCluster: MapCluster?
    @State private var selectedPoint: MapPoint?

    // Filters. `searchText` narrows the properties; it is not a camera control.
    @State private var searchText = ""
    @State private var families: Set<PropertyFamily> = []

    /// The in-flight fetch. Cancelled rather than raced, so a flick issues one
    /// request instead of one per frame.
    @State private var loadTask: Task<Void, Never>?

    /// Where a stored Commons photograph is served from.
    ///
    /// `nonisolated` on the client, so a view can read it without awaiting the
    /// actor — see FurlPayAPIClient.webOrigin.
    private var webOrigin: URL { container.api.webOrigin }

    var body: some View {
        ZStack(alignment: .top) {
            map
            header
            statusPill
        }
        .background(GuardianColors.background.ignoresSafeArea())
        .navigationTitle("Hotel map")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { HotelMapHaptics.prepare() }
        .onDisappear { loadTask?.cancel() }
        .sheet(item: $selectedCluster) { cluster in
            ClusterSheetView(
                cluster: cluster,
                origin: webOrigin,
                onZoomIn: {
                    selectedCluster = nil
                    zoom(to: cluster)
                },
                onOpenProperty: { member in
                    selectedCluster = nil
                    focus(on: member)
                }
            )
        }
        .sheet(item: $selectedPoint) { point in
            PropertySheetView(point: point, origin: webOrigin, onBook: { selectedPoint = nil })
        }
    }

    // MARK: - Map

    private var map: some View {
        Map(position: $camera) {
            ForEach(clusters) { cluster in
                Annotation(cluster.label, coordinate: cluster.coordinate) {
                    ClusterMarkerView(cluster: cluster, isSelected: selectedCluster?.id == cluster.id)
                        .onTapGesture {
                            HotelMapHaptics.tapped()
                            selectedPoint = nil
                            selectedCluster = cluster
                        }
                }
                // The label is on the marker itself; MapKit's own would sit
                // beside it and repeat the place name at every cluster.
                .annotationTitles(.hidden)
            }

            ForEach(points) { point in
                Annotation(point.name, coordinate: point.coordinate) {
                    PropertyMarkerView(point: point, isSelected: selectedPoint?.id == point.id)
                        .onTapGesture {
                            HotelMapHaptics.tapped()
                            selectedCluster = nil
                            selectedPoint = point
                        }
                }
                .annotationTitles(.hidden)
            }
        }
        // Apple's own POIs would put a second, competing set of pins under ours
        // — including hotels we did not vouch for, in a style we do not control.
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        // NO MapUserLocationButton. It needs
        // NSLocationWhenInUseUsageDescription, which this app has never
        // declared because it has never asked for location — and on iOS a
        // location request without a purpose string is a crash, not a denial.
        // Adding a permission prompt to a payments app is a product decision,
        // not a detail of a browse screen, so the map does without it.
        .mapControls { MapCompass() }
        .onMapCameraChange(frequency: .onEnd) { context in
            schedule(region: context.region)
        }
        .ignoresSafeArea()
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15))
                    .foregroundStyle(GuardianColors.textTertiary)

                TextField("Search hotels, cities…", text: $searchText)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .foregroundStyle(GuardianColors.textPrimary)
                    .onSubmit { reload() }

                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                        reload()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(GuardianColors.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(GuardianColors.surface, in: Capsule())
            .overlay(Capsule().stroke(TripsPalette.tileBorder, lineWidth: 1))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(PropertyFamily.allCases) { family in
                        FilterPill(
                            title: family.title,
                            symbol: family.symbol,
                            isOn: families.contains(family)
                        ) {
                            HotelMapHaptics.tapped()
                            if families.contains(family) { families.remove(family) }
                            else { families.insert(family) }
                            reload()
                        }
                    }
                }
                .padding(.horizontal, 1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
    }

    // MARK: - Status

    private var statusPill: some View {
        VStack {
            Spacer()
            HStack(spacing: 7) {
                if isLoading {
                    ProgressView().controlSize(.small).tint(TripsPalette.green)
                } else {
                    Image(systemName: errorText == nil ? "map" : "exclamationmark.triangle")
                        .font(.system(size: 12))
                }
                Text(statusText)
                    .font(.caption)
                    .lineLimit(2)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(
                errorText == nil ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(GuardianColors.warning),
                in: Capsule()
            )
            .foregroundStyle(errorText == nil ? GuardianColors.textSecondary : Color.black)
            .overlay(Capsule().stroke(TripsPalette.tileBorder, lineWidth: errorText == nil ? 1 : 0))
            .padding(.bottom, 20)
            .animation(.easeOut(duration: 0.2), value: statusText)
        }
        .allowsHitTesting(false)
    }

    /// What the map is allowed to say about itself.
    ///
    /// The counts stay SEPARATE, exactly as on the other two platforms: a
    /// viewport holding 8 curated properties and 196 OpenStreetMap hotels is not
    /// "204 of 507", because those are two different populations.
    private var statusText: String {
        if let errorText { return errorText }
        guard let counts else { return isLoading ? "Loading hotels…" : "Pan the map to load hotels" }

        var parts: [String] = []
        let luxury = counts.curatedInView + counts.curatedClustered
        if luxury == 0 {
            parts.append(
                counts.curatedMatchingWorldwide > 0
                    ? "No luxury properties here — \(counts.curatedMatchingWorldwide) elsewhere"
                    : "No luxury properties match these filters"
            )
        } else {
            parts.append("\(luxury) luxury \(luxury == 1 ? "property" : "properties")")
        }
        if counts.osmInView > 0 { parts.append("\(counts.osmInView) other hotels") }
        // A cap that does not announce itself reads as "this is everything".
        if truncated > 0 { parts.append("\(truncated) more — zoom in") }
        if osmUnavailable { parts.append("OpenStreetMap unavailable") }
        else if osmFilteredOut { parts.append("Filters cover luxury properties only") }
        // How much of the whole dataset has a confirmed position. Stated because
        // the map draws unconfirmed properties too, and a reader deserves to
        // know what share of the pins a second source actually agreed with.
        if let dataset { parts.append("\(dataset.exact)/\(dataset.total) confirmed") }
        return parts.joined(separator: " · ")
    }

    // MARK: - Loading

    /// The last region the camera reported, so a filter change can re-ask it
    /// without waiting for the map to move.
    @State private var lastRegion: MKCoordinateRegion?

    private func schedule(region: MKCoordinateRegion) {
        lastRegion = region
        loadTask?.cancel()
        loadTask = Task {
            // Debounce. `.onEnd` already fires once per gesture, but a pinch
            // that settles in stages emits several, and each one is a request.
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await load(region: region)
        }
    }

    private func reload() {
        guard let lastRegion else { return }
        schedule(region: lastRegion)
    }

    private func load(region: MKCoordinateRegion) async {
        isLoading = true
        defer { isLoading = false }

        let bbox = MapBBox(
            minLat: region.center.latitude - region.span.latitudeDelta / 2,
            minLng: region.center.longitude - region.span.longitudeDelta / 2,
            maxLat: region.center.latitude + region.span.latitudeDelta / 2,
            maxLng: region.center.longitude + region.span.longitudeDelta / 2
        )

        do {
            let response = try await container.api.fetchHotelMap(
                bbox: bbox,
                zoom: Self.zoomLevel(for: region),
                // SORTED, not just Array(): a Set iterates in an unspecified
                // order, so the same filter would otherwise produce a different
                // query string each time and defeat any HTTP caching in front
                // of the route.
                families: families.sorted { $0.rawValue < $1.rawValue },
                query: searchText.trimmingCharacters(in: .whitespaces)
            )
            guard !Task.isCancelled else { return }
            // Markers settle in rather than snapping, which makes a refresh read
            // as the same map updating instead of a new one appearing.
            withAnimation(.easeOut(duration: 0.22)) {
                clusters = response.clusters
                points = response.points
                counts = response.counts
                dataset = response.dataset
                truncated = response.truncated
                osmFilteredOut = response.osmFilteredOut
                osmUnavailable = response.osmUnavailable
            }
            errorText = nil
        } catch is CancellationError {
            // A superseded request is not a failure.
        } catch {
            guard !Task.isCancelled else { return }
            errorText = "Could not load hotels for this area"
        }
    }

    /// A slippy-map zoom level from a MapKit span.
    ///
    /// MapKit has no zoom level — it has a span in degrees — and the server's
    /// clustering is keyed to the web's zoom. Converting here rather than
    /// sending a span keeps ONE definition of what a zoom level means across
    /// the three clients: the whole world is 360° at z0, and each level halves
    /// it, so z = log2(360 / longitudeDelta).
    static func zoomLevel(for region: MKCoordinateRegion) -> Double {
        let delta = max(region.span.longitudeDelta, 0.000_001)
        return max(0, min(20, log2(360 / delta)))
    }

    // MARK: - Camera

    /// Fit exactly the properties a cluster counted — the same guarantee the web
    /// makes, which is what keeps the number checkable.
    private func zoom(to cluster: MapCluster) {
        HotelMapHaptics.expanded()
        let bounds = cluster.bounds
        let center = CLLocationCoordinate2D(
            latitude: (bounds.minLat + bounds.maxLat) / 2,
            longitude: (bounds.minLng + bounds.maxLng) / 2
        )
        // A 40% margin, and a floor so a cluster whose members share one
        // coordinate does not zoom to an infinitely small span.
        let span = MKCoordinateSpan(
            latitudeDelta: max((bounds.maxLat - bounds.minLat) * 1.4, 0.01),
            longitudeDelta: max((bounds.maxLng - bounds.minLng) * 1.4, 0.01)
        )
        withAnimation(.easeInOut(duration: 0.65)) {
            camera = .region(MKCoordinateRegion(center: center, span: span))
        }
    }

    private func focus(on member: ClusterMember) {
        withAnimation(.easeInOut(duration: 0.65)) {
            camera = .region(
                MKCoordinateRegion(
                    center: member.coordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                )
            )
        }
    }
}

// MARK: - Filter pill

private struct FilterPill: View {
    let title: String
    let symbol: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    isOn ? AnyShapeStyle(TripsPalette.green) : AnyShapeStyle(.ultraThinMaterial),
                    in: Capsule()
                )
                .foregroundStyle(isOn ? GuardianColors.background : GuardianColors.textSecondary)
                .overlay(Capsule().stroke(TripsPalette.tileBorder, lineWidth: isOn ? 0 : 1))
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.25, dampingFraction: 0.8), value: isOn)
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Entry point

/// The card that opens the map from the Travel hub.
///
/// A row rather than a button: it is a place to go, not an action to take, and
/// the chevron is what says so. The emerald wash marks it as the Trips surface
/// without borrowing the accent that means "confirm" elsewhere in the app.
struct ExploreMapCard: View {
    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(TripsPalette.green.opacity(0.16))
                Image(systemName: "map.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(TripsPalette.green)
            }
            .frame(width: 46, height: 46)

            VStack(alignment: .leading, spacing: 2) {
                Text("Explore the map")
                    .font(.callout.weight(.bold))
                    .foregroundStyle(GuardianColors.textPrimary)
                // Deliberately no count. The card is rendered before anything is
                // fetched, so any number here would be a constant that goes
                // stale the moment the dataset changes — and the map itself
                // states the real figures once it has them.
                Text("Luxury hotels and resorts worldwide")
                    .font(.caption)
                    .foregroundStyle(GuardianColors.textSecondary)
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(GuardianColors.textTertiary)
        }
        .padding(14)
        .background(TripsPalette.tile, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(TripsPalette.cardBorder, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}
