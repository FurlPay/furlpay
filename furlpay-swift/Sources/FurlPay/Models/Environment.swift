import Foundation

public enum Environment {
    case production
    case sandbox

    var baseURL: URL {
        switch self {
        case .production:
            return URL(string: "https://api.furlpay.com/v1")!
        case .sandbox:
            return URL(string: "https://sandbox.furlpay.com/v1")!
        }
    }
}