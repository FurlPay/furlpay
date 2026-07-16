package com.furlpay.guardian.sync

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * Thin coroutine wrapper over the Wearable [DataClient]. Payloads are JSON
 * strings under [SyncProtocol.KEY_JSON] — one shape both sides parse via
 * the snapshot types in SyncProtocol.kt.
 */
class DataLayerManager(context: Context) {

    private val dataClient: DataClient = Wearable.getDataClient(context.applicationContext)

    /** Publish latest-value state (urgent — tiles want it now, not batched). */
    suspend fun putJson(path: String, json: String, sentAtMs: Long = System.currentTimeMillis()) {
        val request = PutDataMapRequest.create(path).apply {
            dataMap.putInt(SyncProtocol.KEY_VERSION, SyncProtocol.VERSION)
            dataMap.putString(SyncProtocol.KEY_JSON, json)
            dataMap.putLong(SyncProtocol.KEY_SENT_AT, sentAtMs)
        }.asPutDataRequest().setUrgent()
        dataClient.putDataItem(request).await()
    }

    /** Latest stored payload for [path], or null if nothing synced yet. */
    suspend fun latestJson(path: String): String? {
        val items = dataClient.dataItems.await()
        return try {
            items.filter { it.uri.path == path }
                .maxByOrNull { DataMapItem.fromDataItem(it).dataMap.getLong(SyncProtocol.KEY_SENT_AT) }
                ?.let { DataMapItem.fromDataItem(it).dataMap.getString(SyncProtocol.KEY_JSON) }
        } finally {
            items.release()
        }
    }

    /** Stream of payload updates for [path] (emits on every remote change). */
    fun jsonUpdates(path: String): Flow<String> = callbackFlow {
        val listener = DataClient.OnDataChangedListener { buffer ->
            for (event in buffer) {
                if (event.type != DataEvent.TYPE_CHANGED) continue
                if (event.dataItem.uri.path != path) continue
                DataMapItem.fromDataItem(event.dataItem)
                    .dataMap.getString(SyncProtocol.KEY_JSON)
                    ?.let { trySend(it) }
            }
        }
        // Scope the listener to this path only.
        val uri = Uri.parse("wear://*$path")
        dataClient.addListener(listener, uri, DataClient.FILTER_LITERAL)
        awaitClose { dataClient.removeListener(listener) }
    }
}
