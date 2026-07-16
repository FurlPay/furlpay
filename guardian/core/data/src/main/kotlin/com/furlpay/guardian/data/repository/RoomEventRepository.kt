package com.furlpay.guardian.data.repository

import com.furlpay.guardian.data.db.EventDao
import com.furlpay.guardian.data.db.EventEntity
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.EventSource
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.repository.EventRepository
import kotlinx.datetime.Instant

/** Room-backed Life Guardian feed. */
class RoomEventRepository(private val dao: EventDao) : EventRepository {

    override suspend fun activeEvents(): GuardianResult<List<GuardianEvent>> =
        try {
            GuardianResult.Ok(dao.active().map { it.toDomain() })
        } catch (e: Exception) {
            GuardianResult.Err(e.message ?: "Event store failed", e)
        }

    override suspend fun upsert(events: List<GuardianEvent>): GuardianResult<Unit> =
        try {
            dao.upsert(events.map { it.toEntity() })
            GuardianResult.Ok(Unit)
        } catch (e: Exception) {
            GuardianResult.Err(e.message ?: "Event store failed", e)
        }

    override suspend fun acknowledge(eventId: String): GuardianResult<Unit> =
        try {
            dao.acknowledge(eventId)
            GuardianResult.Ok(Unit)
        } catch (e: Exception) {
            GuardianResult.Err(e.message ?: "Event store failed", e)
        }
}

private fun EventEntity.toDomain() = GuardianEvent(
    id = id,
    source = runCatching { EventSource.valueOf(source) }.getOrDefault(EventSource.MANUAL),
    title = title,
    detail = detail,
    startAt = startAtMs?.let(Instant::fromEpochMilliseconds),
    priority = runCatching { EventPriority.valueOf(priority) }.getOrDefault(EventPriority.MEDIUM),
    actionUrl = actionUrl,
    acknowledged = acknowledged,
)

private fun GuardianEvent.toEntity() = EventEntity(
    id = id,
    source = source.name,
    title = title,
    detail = detail,
    startAtMs = startAt?.toEpochMilliseconds(),
    priority = priority.name,
    actionUrl = actionUrl,
    acknowledged = acknowledged,
)
