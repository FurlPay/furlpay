import Foundation

public struct CreatePaymentParams: Codable {
    public let amount: Double
    public let currency: String
    public let merchantId: String
    public let memo: String?
    public let metadata: [String: String]?
}