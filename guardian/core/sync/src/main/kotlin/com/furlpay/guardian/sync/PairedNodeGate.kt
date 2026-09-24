package com.furlpay.guardian.sync

import android.content.Context
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await

/**
 * "Did this actually come from my phone?"
 *
 * WHY THIS EXISTS
 *
 * `WearListenerService` accepted [SyncProtocol.DATA_AUTH_TOKEN] from any source
 * and wrote it straight into the Keystore-backed token store. `sourceNodeId`
 * appeared nowhere in the codebase — there was no check at all, on any path.
 *
 * The Data Layer is app-namespaced and mediated by Play Services, which bounds
 * the exposure considerably: another app cannot publish into this app's
 * namespace. But "bounded by the platform" is not the same as "checked", and
 * the auth-token path is the one place where the difference is worth paying
 * for. A watch can be paired to more than one node over its life, and the
 * session token is the credential that lets this watch spend money on its own
 * when the phone is unreachable.
 *
 * WHAT IT CHECKS
 *
 * That the sending node is a node this device is currently connected to. That
 * is the strongest statement the Wearable API can actually support: node ids
 * are opaque and reassigned on re-pair, so pinning one permanently would break
 * the app the first time the user factory-resets their phone — turning a
 * security control into a support ticket with no recovery path in the UI.
 *
 * WHAT IT DOES NOT CLAIM
 *
 * This is not authentication. A connected node is a node Play Services says is
 * reachable and running this application; it is not proof of the user. The
 * server's own validation of the JWT remains the real control, and a token that
 * arrives here still has to survive that. This closes the gap between "the
 * platform probably prevents this" and "we checked".
 */
class PairedNodeGate(context: Context) {

    private val nodeClient = Wearable.getNodeClient(context.applicationContext)

    /**
     * True when [sourceNodeId] is a currently-connected node.
     *
     * FAILS CLOSED. If the node list cannot be read — Play Services updating,
     * no connectivity, a transient Task failure — this returns false and the
     * payload is dropped. For a snapshot that costs one stale tile until the
     * next sync; for the auth token it costs one sign-in. Both are cheaper than
     * accepting an unverified credential, and the phone re-pushes on its next
     * `pushAll()` either way.
     */
    suspend fun isConnectedNode(sourceNodeId: String?): Boolean {
        if (sourceNodeId.isNullOrBlank()) return false
        return runCatching {
            nodeClient.connectedNodes.await().any { it.id == sourceNodeId }
        }.getOrDefault(false)
    }
}
