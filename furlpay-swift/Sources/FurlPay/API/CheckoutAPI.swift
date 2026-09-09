import Foundation

public class CheckoutAPI {
    let client: HTTPClient
    init(client: HTTPClient) { self.client = client }
    
    public func createSession(amount: Double, currency: String) async throws -> CheckoutSession {
        return try await client.request(method: "POST", path: "/checkout/sessions", body: ["amount": amount, "currency": currency])
    }
    public func getSession(id: String) async throws -> CheckoutSession {
        return try await client.request(method: "GET", path: "/checkout/sessions/\(id)")
    }
}