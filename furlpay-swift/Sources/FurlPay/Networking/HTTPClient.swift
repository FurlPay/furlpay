import Foundation

class HTTPClient {
    let apiKey: String
    let environment: Environment
    let session = URLSession.shared
    
    init(apiKey: String, environment: Environment) {
        self.apiKey = apiKey
        self.environment = environment
    }
    
    func request<T: Decodable, U: Encodable>(method: String, path: String, body: U?) async throws -> T {
        var req = URLRequest(url: environment.baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.addValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        if let body = body {
            req.httpBody = try JSONEncoder().encode(body)
            req.addValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        
        let (data, _) = try await session.data(for: req)
        return try JSONDecoder().decode(T.self, from: data)
    }
    
    func request<T: Decodable>(method: String, path: String) async throws -> T {
        return try await request(method: method, path: path, body: Optional<String>.none)
    }
}