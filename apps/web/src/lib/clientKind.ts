/**
 * Is this request from the native app rather than a browser?
 *
 * Native clients have no cookie jar, so auth routes must return the session JWT
 * in the response BODY for them (the app stores it in the Android Keystore and
 * sends it back as `Authorization: Bearer`). Browsers must keep getting the
 * HttpOnly cookie and nothing else — handing a token to page JS would put a
 * bearer credential somewhere XSS can read it.
 *
 * The app identifies itself with `X-Furlpay-Client: mobile-android/<version>`
 * (see native-app/lib/api.ts).
 *
 * This header is NOT a security boundary — anyone can send it. It only selects
 * the delivery channel for a token the caller has already legitimately earned by
 * completing the ceremony. Never gate authorization on it.
 */
export function isMobileClient(req: { headers: { get(name: string): string | null } }): boolean {
  return (req.headers.get("x-furlpay-client") ?? "").startsWith("mobile");
}
