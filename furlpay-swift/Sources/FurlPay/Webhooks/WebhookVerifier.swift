import Foundation
import CryptoKit

public class WebhookVerifier {
    public static func verify(payload: Data, signature: String, secret: String) -> Bool {
        let key = SymmetricKey(data: Data(secret.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: payload, using: key)
        let expected = Data(mac).map { String(format: "%02x", $0) }.joined()
        return expected.elementsEqual(signature)
    }
}