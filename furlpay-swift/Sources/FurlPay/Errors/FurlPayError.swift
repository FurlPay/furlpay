import Foundation

public enum FurlPayError: Error {
    case authenticationError
    case invalidRequest
    case paymentFailed
    case networkError
    case rateLimited
}