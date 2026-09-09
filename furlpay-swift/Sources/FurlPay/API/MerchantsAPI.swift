import Foundation

public class MerchantsAPI {
    let client: HTTPClient
    init(client: HTTPClient) { self.client = client }
    
    public func getBalance() async throws -> MerchantBalance {
        return try await client.request(method: "GET", path: "/merchants/balance")
    }
    public func createPayout(amount: Double) async throws -> [String: String] {
        return try await client.request(method: "POST", path: "/merchants/payout", body: ["amount": amount])
    }
}