//
//  HotelMapModels.swift
//
//  The wire types for /api/travel/hotels/map — the same endpoint the web map
//  and the Android app read. It already does the clustering, the OpenStreetMap
//  merge, the dedupe and the counting, so nothing here recomputes any of it;
//  this file is a faithful transcription of what the server sends.
//
//  CoreLocation, NOT MapKit. This file lives in Shared/Models, and project.yml
//  compiles that directory into the watch app and both extensions as well as
//  the phone. MapKit is unavailable to a widget extension and heavily reduced on
//  watchOS, so importing it here would break two targets that never draw a map.
//  CLLocationCoordinate2D is CoreLocation and is available everywhere.
//
//  EVERY FIELD THE SERVER MAY OMIT IS OPTIONAL, and that is load-bearing rather
//  than defensive: `stars` absent means nobody recorded a star rating, which is
//  not the same as zero, and `precision` absent means the position was never
//  confirmed. Decoding those to a default would erase the distinction the whole
//  dataset is built to preserve.
//

import CoreLocation
import Foundation

// MARK: - Points

/// One curated luxury property, or one hotel OpenStreetMap records.
public struct MapPoint: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let kind: String
    /// `curated` (one of the 507 luxury properties) or `osm`.
    public let source: String
    public let latitude: Double
    public let longitude: Double
    public let name: String
    public let city: String
    public let country: String
    /// Absent is not zero — see the file note.
    public let stars: Int?
    public let brand: String?
    public let website: String?
    /// OSM `tourism` value, or the curated property type.
    public let hotelType: String
    public let categories: [String]?
    /// `exact` only when Google confirmed the building; otherwise `approximate`.
    public let precision: String?
    /// Google's place ID — the one Places field that may be stored.
    public let placeId: String?
    public let googleMapsUri: String?
    /// FurlPay L-Score, 0–100. Ranking only; never shown as a rating.
    public let lScore: Double?
    public let corroboratedByOsm: Bool?
    /// A stored Commons photograph, relative to the web origin.
    public let imageLocalPath: String?
    public let imageUrl: String?
    public let imageThumbUrl: String?
    public let imageCredit: String?

    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// True only when a second source agreed on the building.
    public var isConfirmed: Bool { precision == "exact" }
    public var isCurated: Bool { source == "curated" }
}

// MARK: - Clusters

/// One property inside a cluster, as the sheet lists it.
public struct ClusterMember: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let city: String
    public let country: String
    public let propertyType: String
    public let stars: Int?
    public let categories: [String]
    public let precision: String
    public let placeId: String?
    public let latitude: Double
    public let longitude: Double
    public let imageLocalPath: String?
    public let imageUrl: String?
    public let imageThumbUrl: String?
    public let imageCredit: String?

    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
    public var isConfirmed: Bool { precision == "exact" }
}

/// How a cluster's members split across the three property families.
///
/// These SUM to the cluster's count — the server partitions the taxonomy
/// completely — which is what lets the sheet print all four numbers together
/// without its own arithmetic failing in front of the reader.
public struct MapFamilies: Codable, Sendable, Hashable {
    public let hotels: Int
    public let resorts: Int
    public let villas: Int

    public var total: Int { hotels + resorts + villas }
}

public struct MapBounds: Codable, Sendable, Hashable {
    public let minLat: Double
    public let minLng: Double
    public let maxLat: Double
    public let maxLng: Double
}

/// N curated properties drawn as one circle.
///
/// The count is a real count of real properties, and tapping the cluster fits
/// exactly the ones it counted — which is what makes the number checkable
/// rather than decorative.
public struct MapCluster: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let kind: String
    public let latitude: Double
    public let longitude: Double
    public let count: Int
    public let topName: String
    /// A city when the members share one, otherwise a country, otherwise a
    /// region — derived from the members, never invented.
    public let label: String
    public let sublabel: String
    public let families: MapFamilies
    /// How many of the members have a Google-confirmed position.
    public let confirmed: Int
    public let top: [ClusterMember]
    public let bounds: MapBounds

    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Response

/// Counts, kept SEPARATE because they count different things.
///
/// A viewport holding 8 curated properties and 196 OpenStreetMap hotels is not
/// "204 of 507": those are two populations, and collapsing them invites the
/// reading that 204 of the 507 curated properties are on screen.
public struct MapCounts: Codable, Sendable, Hashable {
    public let curatedInView: Int
    public let curatedClustered: Int
    public let osmInView: Int
    public let curatedMatchingWorldwide: Int
}

/// What the dataset knows about itself.
public struct MapDataset: Codable, Sendable, Hashable {
    public let total: Int
    public let exact: Int
    public let approximate: Int
    public let stale: Int
    public let generatedAt: String
}

public struct MapResponse: Codable, Sendable {
    public let points: [MapPoint]
    public let clusters: [MapCluster]
    public let counts: MapCounts
    /// How many markers the render budget dropped. A cap that does not announce
    /// itself reads as "this is everything", which it is not.
    public let truncated: Int
    public let osmZoomIn: Bool
    public let osmUnavailable: Bool
    public let osmFilteredOut: Bool
    public let dataset: MapDataset
    public let fetchedAt: String
    public let attribution: String
}

// MARK: - Request

public struct MapBBox: Sendable, Hashable {
    public let minLat: Double
    public let minLng: Double
    public let maxLat: Double
    public let maxLng: Double

    public init(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
        self.minLat = minLat
        self.minLng = minLng
        self.maxLat = maxLat
        self.maxLng = maxLng
    }

    /// `minLng,minLat,maxLng,maxLat` — LONGITUDE FIRST, as the server parses it.
    /// Getting the order backwards produces a valid-looking box over the wrong
    /// part of the earth rather than an error, so it is built in one place.
    public var queryValue: String {
        [minLng, minLat, maxLng, maxLat]
            .map { String(format: "%.4f", $0) }
            .joined(separator: ",")
    }
}

/// The three families the filter controls offer.
public enum PropertyFamily: String, CaseIterable, Sendable, Identifiable {
    case hotels, resorts, villas
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .hotels: "Hotels"
        case .resorts: "Resorts"
        case .villas: "Villas"
        }
    }

    /// SF Symbols only — the app has no bundled icon set, and a symbol scales
    /// with Dynamic Type and inherits the tint for free.
    public var symbol: String {
        switch self {
        case .hotels: "building.2"
        case .resorts: "beach.umbrella"
        case .villas: "house"
        }
    }
}
