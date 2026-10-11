import Foundation
import Testing
@testable import FurlPayGuardian

private actor SessionResponses {
    typealias Handler = @Sendable (URLRequest) async throws -> (Int, String)
    private var handlers: [String: Handler] = [:]

    func set(_ host: String, handler: @escaping Handler) { handlers[host] = handler }
    func remove(_ host: String) { handlers.removeValue(forKey: host) }
    func respond(_ request: URLRequest) async throws -> (Int, String) {
        guard let handler = handlers[request.url!.host!] else { throw URLError(.badURL) }
        return try await handler(request)
    }
}

private final class SessionURLProtocol: URLProtocol, @unchecked Sendable {
    static let responses = SessionResponses()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task {
            do {
                let (status, body) = try await Self.responses.respond(request)
                let response = HTTPURLResponse(url: request.url!, statusCode: status,
                                               httpVersion: nil, headerFields: nil)!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: Data(body.utf8))
                client?.urlProtocolDidFinishLoading(self)
            } catch {
                client?.urlProtocol(self, didFailWithError: error)
            }
        }
    }
    override func stopLoading() {}
}

@Suite("Session isolation")
struct SessionIsolationTests {
    @Test("Refresh rotates a session; explicit sign-in invalidates old snapshots")
    func snapshotOwnership() async throws {
        let store = KeychainTokenStore(service: "test.\(UUID())")
        try await store.save("old")
        let original = await store.snapshot()
        #expect(try await store.replaceIfCurrent(original, with: "rotated"))
        let rotated = await store.snapshot()
        #expect(rotated.generation == original.generation)
        #expect(!(await store.clearIfCurrent(original)))
        // Even signing in with the same bytes is a new session.
        try await store.save("old")
        #expect(!(try await store.replaceIfCurrent(original, with: "stale")))
        #expect(!(await store.clearIfCurrent(original)))
        #expect(await store.get() == "old")
        await store.clear()
    }

    @Test("An account switch during refresh cancels the waiting operation")
    func switchDuringRefresh() async throws {
        let store = KeychainTokenStore(service: "test.\(UUID())")
        let payload = Data("{\"exp\":1}".utf8).base64EncodedString()
        try await store.save("header.\(payload).signature")
        let host = "\(UUID().uuidString.lowercased()).example.test"
        await SessionURLProtocol.responses.set(host) { request in
            #expect(request.url?.path == "/api/auth/refresh", "The original operation must never be dispatched")
            try await store.save("new-account")
            return (200, "{\"token\":\"stale-refresh\"}")
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SessionURLProtocol.self]
        let session = URLSession(configuration: config)
        let api = FurlPayAPIClient(baseURL: URL(string: "https://\(host)/api/")!,
                                  session: session, tokenStore: store)
        do {
            try await api.revokePasskey(id: "credential")
            Issue.record("A request from the previous account completed")
        } catch APIError.cancelled {
            // Expected before the authenticated operation is sent.
        }
        #expect(await store.get() == "new-account")
        session.invalidateAndCancel()
        await SessionURLProtocol.responses.remove(host)
        await store.clear()
    }

    @Test("Stale responses cannot complete or sign out a new account", arguments: [200, 401])
    func switchDuringResponse(status: Int) async throws {
        let store = KeychainTokenStore(service: "test.\(UUID())")
        try await store.save("original-account")
        let host = "\(UUID().uuidString.lowercased()).example.test"
        await SessionURLProtocol.responses.set(host) { request in
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer original-account")
            try await store.save("new-account")
            return (status, "{}")
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SessionURLProtocol.self]
        let session = URLSession(configuration: config)
        let api = FurlPayAPIClient(baseURL: URL(string: "https://\(host)/api/")!,
                                  session: session, tokenStore: store)
        do {
            try await api.revokePasskey(id: "credential")
            Issue.record("A response from the previous account completed")
        } catch APIError.cancelled {
            // Both success and 401 belong to the previous login.
        }
        #expect(await store.get() == "new-account")
        session.invalidateAndCancel()
        await SessionURLProtocol.responses.remove(host)
        await store.clear()
    }
}
