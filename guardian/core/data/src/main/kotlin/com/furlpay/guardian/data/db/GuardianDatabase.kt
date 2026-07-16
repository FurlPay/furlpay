package com.furlpay.guardian.data.db

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

// ---------------------------------------------------------------------------
// Room schema. Two tables only, on purpose:
//  - guardian_events: the Life Guardian feed (needs querying/acknowledging)
//  - snapshot_cache:  latest-JSON cache for wallet/portfolio/trips — the same
//    hydrate-on-touch pattern the web app's durable store uses. Snapshots are
//    render-ready; there is nothing relational to gain from normalizing them.
// ---------------------------------------------------------------------------

@Entity(tableName = "guardian_events")
data class EventEntity(
    @PrimaryKey val id: String,
    val source: String,
    val title: String,
    val detail: String?,
    val startAtMs: Long?,
    val priority: String,
    val actionUrl: String?,
    val acknowledged: Boolean,
)

@Dao
interface EventDao {
    @Query("SELECT * FROM guardian_events WHERE acknowledged = 0 ORDER BY startAtMs IS NULL, startAtMs ASC")
    suspend fun active(): List<EventEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(events: List<EventEntity>)

    @Query("UPDATE guardian_events SET acknowledged = 1 WHERE id = :id")
    suspend fun acknowledge(id: String)

    @Query("DELETE FROM guardian_events WHERE startAtMs IS NOT NULL AND startAtMs < :beforeMs AND acknowledged = 1")
    suspend fun pruneAcknowledgedBefore(beforeMs: Long)
}

@Entity(tableName = "snapshot_cache")
data class SnapshotEntity(
    /** SyncProtocol data path doubles as the cache key. */
    @PrimaryKey val key: String,
    val json: String,
    val updatedAtMs: Long,
)

@Dao
interface SnapshotDao {
    @Query("SELECT * FROM snapshot_cache WHERE `key` = :key")
    suspend fun get(key: String): SnapshotEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entity: SnapshotEntity)
}

@Database(
    entities = [EventEntity::class, SnapshotEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class GuardianDatabase : RoomDatabase() {
    abstract fun events(): EventDao
    abstract fun snapshots(): SnapshotDao

    companion object {
        @Volatile
        private var instance: GuardianDatabase? = null

        fun get(context: Context): GuardianDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    GuardianDatabase::class.java,
                    "guardian.db",
                ).build().also { instance = it }
            }
    }
}
