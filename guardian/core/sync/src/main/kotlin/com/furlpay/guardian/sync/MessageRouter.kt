package com.furlpay.guardian.sync

import android.content.Context
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.tasks.await

/**
 * Fire-and-forget messages (watch → phone commands). Data that must survive
 * disconnection goes through [DataLayerManager] instead — MessageClient drops
 * messages when no node is reachable, and that is the point: a stale voice
 * command should die, not replay an hour later.
 */
class MessageRouter(context: Context) {

    private val appContext = context.applicationContext
    private val messageClient = Wearable.getMessageClient(appContext)
    private val nodeClient = Wearable.getNodeClient(appContext)

    /**
     * Send to the best (nearest) connected node. Returns false when no node is
     * reachable — callers surface "phone unreachable", never silently drop.
     */
    suspend fun send(path: String, payload: ByteArray): Boolean {
        val nodes = nodeClient.connectedNodes.await()
        val target = nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull() ?: return false
        messageClient.sendMessage(target.id, path, payload).await()
        return true
    }
}
