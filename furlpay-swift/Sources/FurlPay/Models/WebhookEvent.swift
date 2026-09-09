import Foundation

public struct WebhookEvent: Codable {
    public let type: String
    public let data: [String: String]
    public let timestamp: Date
}