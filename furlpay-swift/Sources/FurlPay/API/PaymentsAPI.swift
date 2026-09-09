import Foundation

public class PaymentsAPI {
    let client: HTTPClient
    init(client: HTTPClient) { self.client = client }
    
    public func create(params: CreatePaymentParams) async throws -> Payment {
        return try await client.request(method: "POST", path: "/payments", body: params)
    }
    public func get(id: String) async throws -> Payment {
        return try await client.request(method: "GET", path: "/payments/\(id)")
    }
    public func list() async throws -> [Payment] {
        return try await client.request(method: "GET", path: "/payments")
    }
    public func refund(id: String) async throws -> Payment {
        return try await client.request(method: "POST", path: "/payments/\(id)/refund")
    }
}