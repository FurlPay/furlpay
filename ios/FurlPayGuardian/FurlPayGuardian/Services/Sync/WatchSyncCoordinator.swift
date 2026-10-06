//
//  WatchSyncCoordinator.swift
//
//  Port of guardian/core/sync (DataLayerManager + MessageRouter) onto
//  WatchConnectivity.
//
//  Transport choice matters and is not interchangeable:
//    sendMessage              real-time, requires reachability — the auth token
//                             at sign-in, and voice relays
//    transferUserInfo         queued, guaranteed, survives the app being killed
//                             — the periodic snapshot
//    updateApplicationContext latest-value-wins, overwrites the previous — used
//                             for nothing here, because a snapshot that silently
//                             replaces an unread one loses events
//

import Foundation
import WatchConnectivity

@MainActor
@Observable
public final class WatchSyncCoordinator: NSObject {

    public private(set) var isPaired = false
    public private(set) var isReachable = false
    public private(set) var lastPushed: Date?

    private weak var container: ServiceContainer?

    public override init() { super.init() }

    public func activate(container: ServiceContainer) {
        self.container = container
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    // MARK: Phone -> Watch

    /// Sent the moment the user signs in. Tried live first so the watch is
    /// usable immediately, with a queued fallback so it still arrives if the
    /// watch is out of range.
    public func pushToken(_ token: String) async {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        if session.isReachable {
            session.sendMessage([SyncKey.token: token], replyHandler: nil) { _ in
                session.transferUserInfo([SyncKey.token: token])
            }
        } else {
            session.transferUserInfo([SyncKey.token: token])
        }
    }

    /// Revoke the watch's copy of the session.
    ///
    /// The mirror of `pushToken`, and its absence was a real defect: `signOut()`
    /// cleared the phone's keychain, repositories and assistant transcript while
    /// the paired watch kept a valid bearer token until the JWT's own expiry.
    /// The watch calls the API directly when the phone is unreachable, so that
    /// token authenticated real requests — selling or returning the phone did
    /// not revoke it.
    ///
    /// BOTH TRANSPORTS, ALWAYS — unlike `pushToken`, which prefers the live
    /// path and falls back. A sign-out that is only attempted while the watch
    /// happens to be reachable is a sign-out that silently does not happen when
    /// the watch is in another room, which is exactly when it matters.
    /// `transferUserInfo` is queued and guaranteed: it survives the watch being
    /// out of range, powered off, or the app being killed, and lands on next
    /// contact. Sending both means a reachable watch clears immediately AND an
    /// unreachable one clears eventually. Duplicate delivery is harmless —
    /// clearing an already-cleared store is a no-op.
    public func clearToken() async {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        let payload: [String: Any] = [SyncKey.signOut: true]
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
        session.transferUserInfo(payload)
    }

    /// The whole snapshot in one transfer. Split per-key it would be possible
    /// for the watch to hold wallets from one minute and a portfolio from
    /// another, and render a Home screen that never existed.
    public func pushAllSnapshots(from container: ServiceContainer) async {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        let snapshot = container.snapshot()
        // Written locally too: the widget extension reads this, and it is the
        // phone's own offline cache.
        SnapshotCache.save(snapshot)

        guard let payload = try? SyncCodec.encode(snapshot) else { return }
        session.transferUserInfo(payload)
        lastPushed = Date()
    }
}

// MARK: - WCSessionDelegate

extension WatchSyncCoordinator: WCSessionDelegate {

    nonisolated public func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        // Read on the delegate queue; only the Bools cross to the main actor.
        // WCSession is not Sendable, so capturing it in the Task is a data race.
        let paired = session.isPaired
        let reachable = session.isReachable
        Task { @MainActor in
            isPaired = paired
            isReachable = reachable
        }
    }

    nonisolated public func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Fires when the user switches to a different watch. Reactivating is
    /// mandatory or every later transfer silently goes nowhere.
    nonisolated public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    nonisolated public func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in isReachable = reachable }
    }

    /// Watch -> phone. The watch cannot perform mutating actions itself, so it
    /// relays them here where a biometric prompt is possible.
    nonisolated public func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        // `message` ([String: Any]) and `replyHandler` are not Sendable. Pull
        // out the Sendable fields here, and box the handler: WatchConnectivity
        // accepts a reply from any thread, so calling it from the main actor is
        // safe, which the compiler cannot see.
        let wantsRefresh = message[SyncKey.requestRefresh] != nil
        let command = message[SyncKey.voiceCommand] as? String
        let reply = ReplyHandler(replyHandler)

        Task { @MainActor in
            if wantsRefresh {
                await container?.refreshAll()
                reply(["ok": true])
                return
            }

            if let command {
                // Read-only by construction: the watch relay has no visible
                // scene on the phone, so a mutating tool call has nowhere to
                // present its confirmation. Mirrors the Android rule for
                // VoiceRelayService running without an Activity.
                let answer = await self.handleVoiceRelay(command)
                reply([SyncKey.voiceResponse: answer])
                return
            }

            reply(["ok": false])
        }
    }

    /// Same parser and same executor as the phone's own voice screen — one
    /// implementation, so a question cannot be answered two different ways
    /// depending on which device heard it.
    private func handleVoiceRelay(_ command: String) async -> String {
        guard let container else { return "Guardian is not ready yet." }

        if let invocation = VoiceCommandParser.parse(command) {
            // A mutating tool relayed from the wrist would put the biometric
            // prompt on the phone, which may be in another room and unattended.
            // Refuse and say where to do it — matching the Wear OS rule that the
            // watch never authorises a mutation.
            if invocation.requiresConfirmation {
                return "That needs confirming on your iPhone."
            }
            return await container.tools.execute(invocation).text
        }

        // The model runs on the PHONE even though the watch asked. It is the
        // device with the neural engine, the repositories and the transcript.
        if let answer = await container.assistant.answer(command) {
            return answer
        }
        return "I can answer about your balance, spending, portfolio, cards, "
            + "trips and schedule."
    }
}

/// WatchConnectivity's reply closure, carried across to the main actor. The
/// replies are built there from Sendable values (Bool, String), and
/// WCSession accepts a reply from any thread.
private struct ReplyHandler: @unchecked Sendable {
    private let handler: ([String: Any]) -> Void
    init(_ handler: @escaping ([String: Any]) -> Void) { self.handler = handler }
    func callAsFunction(_ reply: [String: Any]) { handler(reply) }
}
