package com.furlpay.guardian.data.repository

import com.furlpay.guardian.data.db.SnapshotDao
import com.furlpay.guardian.data.db.SnapshotEntity

/**
 * Latest-JSON cache keyed by SyncProtocol data path. Writers: the phone's
 * sync workers (after a successful API pull) and the watch's listener service
 * (after a Data Layer update). Readers: tiles, complications, and screens in
 * airplane mode. [updatedAtMs] rides along so the UI can label staleness
 * ("as of 07:45") instead of presenting old money as current.
 */
class SnapshotStore(private val dao: SnapshotDao) {

    data class Stored(val json: String, val updatedAtMs: Long)

    suspend fun read(key: String): Stored? =
        try {
            dao.get(key)?.let { Stored(it.json, it.updatedAtMs) }
        } catch (_: Exception) {
            null // cache is best-effort; a broken row must never take down a tile
        }

    suspend fun write(key: String, json: String, updatedAtMs: Long = System.currentTimeMillis()) {
        try {
            dao.put(SnapshotEntity(key, json, updatedAtMs))
        } catch (_: Exception) {
            // Losing a cache write degrades to a network fetch later — fine.
        }
    }
}
