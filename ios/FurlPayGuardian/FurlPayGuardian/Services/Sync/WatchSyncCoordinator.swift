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
        Task { @MainActor in
            isPaired = session.isPaired
            isReachable = session.isReachable
        }
    }

    nonisolated public func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Fires when the user switches to a different watch. Reactivating is
    /// mandatory or every later transfer silently goes nowhere.
    nonisolated public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    nonisolated public func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in isReachable = session.isReachable }
    }

    /// Watch -> phone. The watch cannot perform mutating actions itself, so it
    /// relays them here where a biometric prompt is possible.
    nonisolated public func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        Task { @MainActor in
            if message[SyncKey.requestRefresh] != nil {
                await container?.refreshAll()
                replyHandler(["ok": true])
                return
            }

            if let command = message[SyncKey.voiceCommand] as? String {
                // Read-only by construction: the watch relay has no visible
                // scene on the phone, so a mutating tool call has nowhere to
                // present its confirmation. Mirrors the Android rule for
                // VoiceRelayService running without an Activity.
                let answer = await self.handleVoiceRelay(command)
                replyHandler([SyncKey.voiceResponse: answer])
                return
            }

            replyHandler(["ok": false])
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
