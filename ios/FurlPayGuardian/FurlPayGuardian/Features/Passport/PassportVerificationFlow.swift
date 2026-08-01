//
//  PassportVerificationFlow.swift
//
//  Runs the identity provider's hosted document flow.
//
//  WHY ASWebAuthenticationSession AND NOT WKWebView — the same reasoning the RN
//  app applies to Custom Tabs, and it matters more here than almost anywhere
//  else in the app.
//
//  An in-app WKWebView is a hostile place to ask someone for a passport. The app
//  process can read its cookies and inject JavaScript, so neither the user nor
//  the provider can trust what is running, and the user cannot see the real URL
//  or the padlock to check they are not being phished.
//  ASWebAuthenticationSession runs OUT of this app's reach in Safari's own
//  process, shows the true origin, and is what the provider's fraud tooling
//  expects to see. It also hands back the deep-link return for free.
//
//  Apple's own guidance is the same: use ASWebAuthenticationSession for
//  web-based flows that need to be trustworthy.
//
//  This file never sees the document. The camera feeds the provider directly
//  over the provider's TLS session. What comes back is a session identifier.
//

import Foundation
import AuthenticationServices

@MainActor
public final class PassportVerificationFlow: NSObject {

    /// The scheme the provider redirects to when the flow finishes. Must match
    /// a CFBundleURLScheme in Info.plist or the callback silently never fires.
    public static let callbackScheme = "furlpay"

    private var session: ASWebAuthenticationSession?

    /// Presents the hosted flow and reports how it ended.
    ///
    /// Note what this does NOT return: an approval. See PassportVerifyOutcome.
    public func run(_ scanSession: PassportScanSession) async -> PassportVerifyOutcome {
        guard let url = URL(string: scanSession.sessionUrl),
              url.scheme == "https" else {
            // A non-HTTPS provider URL is either a misconfiguration or an
            // attack. Either way the passport does not go there.
            return .unavailable(reason: "The verification link was not valid.")
        }

        return await withCheckedContinuation { continuation in
            var resumed = false
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: Self.callbackScheme
            ) { callbackURL, error in
                guard !resumed else { return }
                resumed = true

                if let error = error as? ASWebAuthenticationSessionError,
                   error.code == .canceledLogin {
                    continuation.resume(returning: .dismissed(sessionId: scanSession.sessionId))
                    return
                }
                if let error {
                    continuation.resume(returning: .unavailable(reason: error.localizedDescription))
                    return
                }
                // A callback URL means the provider redirected us back, i.e.
                // the user completed the flow. Still only "submitted".
                continuation.resume(
                    returning: callbackURL != nil
                        ? .submitted(sessionId: scanSession.sessionId)
                        : .dismissed(sessionId: scanSession.sessionId)
                )
            }

            session.presentationContextProvider = self
            // FALSE on purpose. An ephemeral session would discard the
            // provider's own device-trust cookies, which their fraud tooling
            // uses to recognise a returning legitimate user — turning it on
            // makes every attempt look like a brand-new device.
            session.prefersEphemeralWebBrowserSession = false

            self.session = session
            if !session.start() {
                resumed = true
                continuation.resume(reason: "Couldn't open the verification page.")
            }
        }
    }

    public func cancel() {
        session?.cancel()
        session = nil
    }
}

extension PassportVerificationFlow: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.keyWindow ?? ASPresentationAnchor()
    }
}

private extension CheckedContinuation<PassportVerifyOutcome, Never> {
    func resume(reason: String) {
        resume(returning: .unavailable(reason: reason))
    }
}
