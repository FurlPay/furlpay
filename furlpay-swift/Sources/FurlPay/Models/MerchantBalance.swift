import Foundation

public struct MerchantBalance: Codable {
    public let available: Double
    public let pending: Double
    public let currency: String
}