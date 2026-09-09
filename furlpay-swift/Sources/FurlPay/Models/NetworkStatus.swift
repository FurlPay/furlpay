import Foundation

public struct NetworkStatus: Codable {
    public let health: String
    public let currentTps: Int
    public let finalityMode: String
    public let alpenglowActive: Bool
}