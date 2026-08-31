//
//  HotelMapTests.swift
//
//  The hotel map's decidable parts.
//
//  The screen itself needs a device and a MapKit surface, so it is verified by
//  running it. What IS testable here is everything the three clients have to
//  agree on — the band table, the category colours, the bbox order and the
//  wire format — and those are exactly the things that break silently.
//
//  THE JSON BELOW IS A REAL RESPONSE, captured from the running server rather
//  than written to match these structs. A fixture invented to fit the model
//  cannot catch the model being wrong about the model, which is the only bug
//  worth testing for here.
//

import Testing
import Foundation
import CoreLocation
import MapKit
@testable import FurlPayGuardian

@Suite("Hotel map — marker bands")
struct HotelMapBandTests {

    @Test("radius grows monotonically with the count")
    func monotonic() {
        let radii = [1, 5, 6, 15, 16, 50, 51, 100, 101, 5_000]
            .map { HotelMapStyle.band(for: $0).radius }
        for i in 1..<radii.count {
            #expect(radii[i] >= radii[i - 1])
        }
    }

    @Test("matches the web's band table exactly")
    func parityWithWeb() {
        // Transcribed from apps/web/src/components/travel/map/layers.ts. If the
        // web changes them this fails, and the phone gets updated too — which is
        // the entire reason the numbers are repeated rather than referenced.
        #expect(HotelMapStyle.band(for: 1).radius == 20)
        #expect(HotelMapStyle.band(for: 5).fillHex == 0x8B_CF4A)
        #expect(HotelMapStyle.band(for: 6).radius == 22)
        #expect(HotelMapStyle.band(for: 15).fillHex == 0x8B_CF4A)
        #expect(HotelMapStyle.band(for: 16).radius == 24)
        #expect(HotelMapStyle.band(for: 50).fillHex == 0xF4_C430)
        #expect(HotelMapStyle.band(for: 51).radius == 26)
        #expect(HotelMapStyle.band(for: 100).fillHex == 0xF9_7316)
        #expect(HotelMapStyle.band(for: 101).radius == 28)
        #expect(HotelMapStyle.band(for: 500).radius == 28)
    }

    @Test("every band is readable", arguments: [0, 1, 5, 15, 50, 100, 500, 10_000])
    func readable(count: Int) {
        let band = HotelMapStyle.band(for: count)
        #expect(band.radius > 0)
        #expect(band.diameter == band.radius * 2)
        // Amber takes dark text, everything else white. A band that got this
        // wrong would render an unreadable count.
        #expect(band.textHex == (band.fillHex == 0xF4_C430 ? 0x1F_2937 : 0xFF_FFFF))
    }

    @Test("a count below the first band still gets one")
    func zeroIsBanded() {
        // Not a case the server produces — a cluster of 0 would not exist — but
        // an unbanded marker would be a marker with no size, so it must not be
        // reachable by any input.
        #expect(HotelMapStyle.band(for: 0).radius == 20)
    }
}

@Suite("Hotel map — category colours")
struct HotelMapCategoryTests {

    @Test("uses the FIRST matching category, in pill order")
    func firstMatchWins() {
        // Order is load-bearing: a property in several collections takes the
        // colour of the earliest, so reordering the table recolours the map.
        #expect(HotelMapStyle.categoryHex(for: ["boutique", "ultra_luxury"]) == 0xB8_860B)
        #expect(HotelMapStyle.categoryHex(for: ["boutique"]) == 0x8B_5CF6)
    }

    @Test("matches the web's palette")
    func parityWithWeb() {
        #expect(HotelMapStyle.categoryHex(for: ["ultra_luxury"]) == 0xB8_860B)
        #expect(HotelMapStyle.categoryHex(for: ["overwater_villas"]) == 0x0E_7490)
        #expect(HotelMapStyle.categoryHex(for: ["alpine_chalets"]) == 0x25_63EB)
        #expect(HotelMapStyle.categoryHex(for: ["heritage_castles"]) == 0x9A_3412)
        #expect(HotelMapStyle.categoryHex(for: ["vineyard_wellness"]) == 0x1B_7A4E)
        #expect(HotelMapStyle.categoryHex(for: ["executive_suites"]) == 0x33_4155)
    }

    @Test("falls back rather than returning nothing")
    func fallback() {
        #expect(HotelMapStyle.categoryHex(for: nil) == HotelMapStyle.defaultCategoryHex)
        #expect(HotelMapStyle.categoryHex(for: []) == HotelMapStyle.defaultCategoryHex)
        #expect(HotelMapStyle.categoryHex(for: ["not_a_category"]) == HotelMapStyle.defaultCategoryHex)
    }

    @Test("carries all ten collections, each with a title")
    func complete() {
        #expect(HotelMapStyle.categories.count == 10)
        for entry in HotelMapStyle.categories {
            #expect(HotelMapStyle.categoryTitle(for: entry.id) == entry.title)
        }
    }

    @Test("an unconfirmed position is drawn differently, not hidden")
    func precisionAffectsOpacity() {
        // The property is real; what is unknown is which building. It must stay
        // on the map and say so.
        #expect(HotelMapStyle.ringOpacity(confirmed: false) < HotelMapStyle.ringOpacity(confirmed: true))
        #expect(HotelMapStyle.fillOpacity(confirmed: false) < HotelMapStyle.fillOpacity(confirmed: true))
    }
}

@Suite("Hotel map — request shape")
struct HotelMapRequestTests {

    @Test("bbox is longitude-first, as the server parses it")
    func bboxOrder() {
        // Getting this backwards yields a valid-looking box over the wrong part
        // of the earth rather than an error, which is why it is built in one
        // place and pinned here.
        let bbox = MapBBox(minLat: 45.41, minLng: 12.30, maxLat: 45.45, maxLng: 12.36)
        #expect(bbox.queryValue == "12.3000,45.4100,12.3600,45.4500")
    }

    @Test("negative and southern coordinates keep their sign")
    func negatives() {
        let bbox = MapBBox(minLat: -34.35, minLng: -71.20, maxLat: -34.20, maxLng: -71.00)
        #expect(bbox.queryValue == "-71.2000,-34.3500,-71.0000,-34.2000")
    }
}

@Suite("Hotel map — wire format")
struct HotelMapDecodingTests {

    /// A real response, captured from the running server.
    private static let responseJSON = """
    {
      "points": [{
        "id": "lux_italy_belmond-hotel-cipriani",
        "kind": "property",
        "source": "curated",
        "latitude": 45.4264169,
        "longitude": 12.341292399999999,
        "name": "Belmond Hotel Cipriani",
        "city": "Venice",
        "country": "Italy",
        "stars": 5,
        "brand": "Belmond",
        "website": "https://www.belmond.com",
        "hotelType": "Hotel",
        "categories": ["ultra_luxury", "michelin_dining"],
        "precision": "exact",
        "placeId": "ChIJ0U-xZiqufkcRAVmQKP082-Y",
        "googleMapsUri": "https://www.google.com/maps/place/?q=place_id:ChIJ0U-xZiqufkcRAVmQKP082-Y",
        "lScore": 76.9,
        "corroboratedByOsm": false
      }],
      "clusters": [{
        "id": "cl_5_58:47",
        "kind": "cluster",
        "latitude": 36.45188968974651,
        "longitude": -5.071338400000002,
        "count": 2,
        "topName": "Finca Cortesin Hotel Golf & Spa",
        "label": "Spain",
        "sublabel": "2 properties",
        "families": { "hotels": 0, "resorts": 2, "villas": 0 },
        "confirmed": 2,
        "top": [{
          "id": "lux_spain_finca-cortesin-hotel-golf-spa",
          "name": "Finca Cortesin Hotel Golf & Spa",
          "city": "Casares",
          "country": "Spain",
          "propertyType": "Resort",
          "stars": 5,
          "categories": ["ultra_luxury", "vineyard_wellness"],
          "precision": "exact",
          "placeId": "ChIJ71JF0afQDA0RUiTkTh4mdIA",
          "latitude": 36.397025,
          "longitude": -5.2235179,
          "imageLocalPath": "/hotels/ultra_luxury/finca-cortesin-hotel-golf-spa.jpg",
          "imageCredit": "Walter Schärer · CC BY-SA 3.0"
        }],
        "bounds": {
          "minLat": 36.397025, "minLng": -5.2235179,
          "maxLat": 36.5067156, "maxLng": -4.9191589
        }
      }],
      "counts": {
        "curatedInView": 3, "curatedClustered": 0,
        "osmInView": 199, "curatedMatchingWorldwide": 507
      },
      "truncated": 0,
      "osmZoomIn": false,
      "osmUnavailable": false,
      "osmFilteredOut": false,
      "dataset": {
        "total": 507, "exact": 479, "approximate": 28, "stale": 0,
        "generatedAt": "2026-08-25T04:52:54.924Z"
      },
      "fetchedAt": "2026-08-25T17:52:36.627Z",
      "attribution": "© OpenStreetMap contributors (ODbL) · Curated positions verified with Google"
    }
    """

    private func decode() throws -> MapResponse {
        try JSONDecoder().decode(MapResponse.self, from: Data(Self.responseJSON.utf8))
    }

    @Test("decodes a real response")
    func decodesResponse() throws {
        let response = try decode()
        #expect(response.points.count == 1)
        #expect(response.clusters.count == 1)
        #expect(response.counts.curatedMatchingWorldwide == 507)
        #expect(response.dataset.exact == 479)
        #expect(response.attribution.contains("OpenStreetMap"))
    }

    @Test("a point keeps its identity and position")
    func point() throws {
        let point = try #require(try decode().points.first)
        #expect(point.name == "Belmond Hotel Cipriani")
        #expect(point.isCurated)
        #expect(point.isConfirmed)
        #expect(point.stars == 5)
        #expect(point.categories == ["ultra_luxury", "michelin_dining"])
        #expect(abs(point.coordinate.latitude - 45.4264169) < 0.000_001)
        #expect(abs(point.coordinate.longitude - 12.3412924) < 0.000_001)
    }

    @Test("fields the server omits decode as absent, never as zero")
    func absenceIsNotZero() throws {
        // This property has no photograph — 356 of the 507 do not — and the
        // server omits the keys entirely rather than sending null or "".
        // Decoding them to a default would erase the distinction the dataset
        // exists to preserve.
        let point = try #require(try decode().points.first)
        #expect(point.imageLocalPath == nil)
        #expect(point.imageUrl == nil)
        #expect(point.imageThumbUrl == nil)
    }

    @Test("a cluster's families sum to its count")
    func familiesPartition() throws {
        // The server partitions the taxonomy completely, which is what lets the
        // sheet print all four numbers together without its arithmetic failing
        // in front of the reader.
        let cluster = try #require(try decode().clusters.first)
        #expect(cluster.families.total == cluster.count)
        #expect(cluster.confirmed <= cluster.count)
    }

    @Test("a cluster's bounds contain its members")
    func boundsContainMembers() throws {
        // Tapping a cluster fits these bounds, so a member outside them would
        // make the count unverifiable — zooming in would show something else.
        let cluster = try #require(try decode().clusters.first)
        for member in cluster.top {
            #expect(member.latitude >= cluster.bounds.minLat)
            #expect(member.latitude <= cluster.bounds.maxLat)
            #expect(member.longitude >= cluster.bounds.minLng)
            #expect(member.longitude <= cluster.bounds.maxLng)
        }
    }

    @Test("a stored photograph carries its attribution")
    func imageCredit() throws {
        // A CC-BY image without its credit is a licence breach, not a cosmetic
        // gap, so the credit has to survive the wire.
        let member = try #require(try decode().clusters.first?.top.first)
        #expect(member.imageLocalPath == "/hotels/ultra_luxury/finca-cortesin-hotel-golf-spa.jpg")
        #expect(member.imageCredit?.contains("CC BY-SA") == true)
    }

    @Test("a local image path resolves against the web origin")
    func imageResolution() throws {
        let member = try #require(try decode().clusters.first?.top.first)
        let url = HotelMapStyle.imageURL(
            localPath: member.imageLocalPath,
            thumbURL: member.imageThumbUrl,
            fullURL: member.imageUrl,
            origin: URL(string: "https://furlpay.com")!
        )
        #expect(url?.absoluteString == "https://furlpay.com/hotels/ultra_luxury/finca-cortesin-hotel-golf-spa.jpg")
    }

    @Test("no photograph resolves to no URL, not a broken one")
    func noImage() {
        #expect(
            HotelMapStyle.imageURL(
                localPath: nil, thumbURL: nil, fullURL: nil,
                origin: URL(string: "https://furlpay.com")!
            ) == nil
        )
    }
}

@Suite("Hotel map — zoom conversion")
struct HotelMapZoomTests {

    @Test("converts a MapKit span to the slippy zoom the server clusters by")
    func zoomFromSpan() {
        // MapKit has no zoom level, only a span in degrees, and the server's
        // clustering is keyed to the web's zoom. One definition, here.
        let world = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
            span: MKCoordinateSpan(latitudeDelta: 180, longitudeDelta: 360)
        )
        #expect(abs(HotelMapView.zoomLevel(for: world) - 0) < 0.01)

        let half = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
            span: MKCoordinateSpan(latitudeDelta: 90, longitudeDelta: 180)
        )
        #expect(abs(HotelMapView.zoomLevel(for: half) - 1) < 0.01)
    }

    @Test("clamps rather than diverging")
    func clamped() {
        // A degenerate span would otherwise produce infinity and a query the
        // server rejects.
        let pinpoint = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 45, longitude: 12),
            span: MKCoordinateSpan(latitudeDelta: 0, longitudeDelta: 0)
        )
        let zoom = HotelMapView.zoomLevel(for: pinpoint)
        #expect(zoom <= 20)
        #expect(zoom >= 0)
        #expect(zoom.isFinite)
    }
}

@Suite("Hotel map — client")
struct HotelMapClientTests {

    @Test("derives the web origin the stored photographs are relative to")
    func webOrigin() {
        // The dataset stores "/hotels/…" paths, so a native client needs the
        // site root — not the API base, which is one path component deeper.
        let client = FurlPayAPIClient(baseURL: URL(string: "https://furlpay.com/api/")!)
        #expect(client.webOrigin.absoluteString == "https://furlpay.com")
    }

    @Test("handles a base with no trailing slash, and a local one with a port")
    func webOriginVariants() {
        #expect(
            FurlPayAPIClient(baseURL: URL(string: "https://furlpay.com/api")!)
                .webOrigin.absoluteString == "https://furlpay.com"
        )
        #expect(
            FurlPayAPIClient(baseURL: URL(string: "http://localhost:3111/api/")!)
                .webOrigin.absoluteString == "http://localhost:3111"
        )
    }
}
