package com.furlpay.guardian.mobile.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.model.EventPriority
import com.furlpay.guardian.domain.model.EventSource
import com.furlpay.guardian.domain.model.GuardianEvent
import com.furlpay.guardian.domain.usecase.PrioritizeEventsUseCase
import com.furlpay.guardian.mobile.mobileServices
import java.util.UUID
import kotlin.time.Duration
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock

/**
 * Manual reminders — the first real feed for the alarm runtime. Creating one
 * writes Room, arms the escalation ladder, and pushes the events snapshot to
 * the watch in the same breath; acknowledging tears the remaining rungs down
 * everywhere. Feed order comes from PrioritizeEventsUseCase (the tested
 * rule), never insertion order.
 */
class RemindersViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val events: List<GuardianEvent> = emptyList(),
        val creating: Boolean = false,
        val message: String? = null,
    )

    private val services = app.mobileServices
    private val prioritize = PrioritizeEventsUseCase()

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = services.eventRepo.activeEvents()) {
                is GuardianResult.Ok ->
                    _state.value = _state.value.copy(events = prioritize(result.value))
                is GuardianResult.Err ->
                    _state.value = _state.value.copy(message = result.message)
            }
        }
    }

    fun create(title: String, inFromNow: Duration, priority: EventPriority) {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) {
            _state.value = _state.value.copy(message = "Give the reminder a title.")
            return
        }
        _state.value = _state.value.copy(creating = true, message = null)
        viewModelScope.launch {
            val event = GuardianEvent(
                id = "manual-${UUID.randomUUID()}",
                source = EventSource.MANUAL,
                title = trimmed,
                startAt = Clock.System.now() + inFromNow,
                priority = priority,
            )
            when (val result = services.eventRepo.upsert(listOf(event))) {
                is GuardianResult.Ok -> {
                    // Arm NOW — a CRITICAL reminder must not wait for the
                    // 15-minute sync heartbeat to start its ladder.
                    runCatching { services.alarmScheduler.armForEvents(listOf(event)) }
                    runCatching { services.sync.pushEvents() }
                    _state.value = _state.value.copy(
                        creating = false,
                        message = if (priority == EventPriority.CRITICAL) {
                            "Reminder set — I'll escalate until you acknowledge."
                        } else {
                            "Reminder set."
                        },
                    )
                    refresh()
                }
                is GuardianResult.Err ->
                    _state.value = _state.value.copy(creating = false, message = result.message)
            }
        }
    }

    fun acknowledge(eventId: String) {
        viewModelScope.launch {
            services.alarmScheduler.cancelEvent(eventId)
            services.eventRepo.acknowledge(eventId)
            runCatching { services.sync.pushEvents() }
            refresh()
        }
    }
}
