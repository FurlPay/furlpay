import Foundation

public struct Payment: Codable {
    public let id: String
    public let status: String
    public let amount: Double
    public let currency: String
    public let txSignature: String?
    public let confirmationTimeMs: Int?
    public let createdAt: Date
}