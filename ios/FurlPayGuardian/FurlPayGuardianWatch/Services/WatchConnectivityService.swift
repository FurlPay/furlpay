//
//  WatchConnectivityService.swift
//
//  Watch side of the sync. Receives snapshots and the auth token; relays voice
//  questions to the phone, which is the only device that can answer them with
//  a biometric prompt available.
//

import Foundation
import WatchConnectivity

final class WatchConnectivityService: NSObject, WCSessionDelegate {

    // @Sendable so a delegate callback can hand the closure to a @MainActor Task
    // without also sending `self`. WCSessionDelegate methods are nonisolated and
    // this class is not Sendable, so capturing `self` in that Task is a Swift 6
    // data-race error ("sending 'self' risks causing data races"). Capturing
    // only the closure avoids it. Safe because the sole consumer, WatchStore, is
    // @MainActor and therefore implicitly Sendable.
    var onSnapshot: (@MainActor @Sendable (GuardianSnapshot) -> Void)?
    var onToken: (@MainActor @Sendable (String) -> Void)?
    var onReachabilityChange: (@MainActor @Sendable (Bool) -> Void)?

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func requestRefresh() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage([SyncKey.requestRefresh: true], replyHandler: nil, errorHandler: nil)
    }

    /// Voice questions go to the phone rather than being answered here.
    ///
    /// Not a performance decision: the phone holds the full repository state and
    /// is the only device where a mutating answer could ever be confirmed. The
    /// watch answering locally would be a second, divergent implementation of
    /// the same logic.
    func relayVoice(_ question: String) async -> String {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else {
            return "Your iPhone is not reachable. Open Guardian on your phone."
        }

        return await withCheckedContinuation { continuation in
            var resumed = false
            session.sendMessage([SyncKey.voiceCommand: question]) { reply in
                guard !resumed else { return }
                resumed = true
                continuation.resume(
                    returning: reply[SyncKey.voiceResponse] as? String ?? "No answer."
                )
            } errorHandler: { error in
                guard !resumed else { return }
                resumed = true
                continuation.resume(returning: "Could not reach your iPhone: \(error.localizedDescription)")
            }
        }
    }

    // MARK: WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let reachable = session.isReachable
        let notify = onReachabilityChange
        Task { @MainActor in notify?(reachable) }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        let notify = onReachabilityChange
        Task { @MainActor in notify?(reachable) }
    }

    /// Queued transfers — the periodic snapshot arrives here.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handle(userInfo)
    }

    /// Live messages — the token at sign-in.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handle(message)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        handle(applicationContext)
    }

    private func handle(_ payload: [String: Any]) {
        if let token = payload[SyncKey.token] as? String, !token.isEmpty {
            let deliver = onToken
            Task { @MainActor in deliver?(token) }
        }
        if let snapshot = SyncCodec.decode(payload) {
            let deliver = onSnapshot
            Task { @MainActor in deliver?(snapshot) }
        }
    }
}
