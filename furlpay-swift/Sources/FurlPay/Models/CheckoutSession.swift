import Foundation

public struct CheckoutSession: Codable {
    public let id: String
    public let url: URL
    public let paymentId: String
    public let expiresAt: Date
}