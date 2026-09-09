import Foundation

public class FurlPayClient {
    public let payments: PaymentsAPI
    public let checkout: CheckoutAPI
    public let merchants: MerchantsAPI
    let httpClient: HTTPClient

    public init(apiKey: String, environment: Environment = .production) {
        self.httpClient = HTTPClient(apiKey: apiKey, environment: environment)
        self.payments = PaymentsAPI(client: httpClient)
        self.checkout = CheckoutAPI(client: httpClient)
        self.merchants = MerchantsAPI(client: httpClient)
    }
}