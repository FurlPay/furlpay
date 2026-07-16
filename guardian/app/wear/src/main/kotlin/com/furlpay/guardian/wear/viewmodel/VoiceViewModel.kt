package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.ai.VoiceCommandParser
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.sync.VoiceCommand
import com.furlpay.guardian.sync.VoiceResponse
import com.furlpay.guardian.wear.wearServices
import java.util.UUID
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Watch voice pipeline: system SpeechRecognizer captured the text; from here
 *   1. relay to the phone (full AI brain) over MessageClient, await the
 *      response on the Data Layer;
 *   2. phone unreachable → run the deterministic parser + local executor
 *      against furlpay.com directly (read-only tools; mutating ones refuse
 *      without the phone's biometric).
 */
class VoiceViewModel(app: Application) : AndroidViewModel(app) {

    sealed interface UiState {
        data object Idle : UiState
        data object Listening : UiState
        data object Processing : UiState
        data class Responding(val text: String, val kind: String) : UiState
        data class Error(val message: String) : UiState
    }

    private val services = app.wearServices

    private val _state = MutableStateFlow<UiState>(UiState.Idle)
    val state: StateFlow<UiState> = _state

    fun onListening() {
        _state.value = UiState.Listening
    }

    fun onSpeechCancelled() {
        _state.value = UiState.Idle
    }

    fun onSpeech(text: String) {
        if (text.isBlank()) {
            _state.value = UiState.Error("Couldn't hear you. Tap to try again.")
            return
        }
        _state.value = UiState.Processing
        viewModelScope.launch {
            val command = VoiceCommand(
                id = UUID.randomUUID().toString(),
                text = text,
                atMs = System.currentTimeMillis(),
            )

            // Subscribe BEFORE sending — a fast phone (rule-parser answers are
            // milliseconds) could otherwise reply before the listener exists
            // and the change event would be lost.
            val awaitResponse = async {
                withTimeoutOrNull(RESPONSE_TIMEOUT_MS) {
                    services.dataLayer.jsonUpdates(SyncProtocol.DATA_VOICE_RESPONSE)
                        .mapNotNull { json ->
                            runCatching {
                                SyncProtocol.json.decodeFromString(VoiceResponse.serializer(), json)
                            }.getOrNull()
                        }
                        .first { it.requestId == command.id }
                }
            }

            val relayed = runCatching {
                services.messages.send(
                    SyncProtocol.MSG_VOICE_COMMAND,
                    SyncProtocol.json.encodeToString(VoiceCommand.serializer(), command).encodeToByteArray(),
                )
            }.getOrDefault(false)

            if (relayed) {
                // Belt-and-braces: if the stream missed it (listener registration
                // is itself async), the stored DataItem still has the answer.
                val response = awaitResponse.await() ?: latestMatching(command.id)
                if (response != null) {
                    _state.value = UiState.Responding(response.text, response.kind)
                    return@launch
                }
                // Phone accepted the message but never answered — fall through
                // to the local path rather than dead-ending the user.
            } else {
                awaitResponse.cancel()
            }

            respondLocally(text)
        }
    }

    private suspend fun latestMatching(requestId: String): VoiceResponse? =
        runCatching {
            services.dataLayer.latestJson(SyncProtocol.DATA_VOICE_RESPONSE)?.let {
                SyncProtocol.json.decodeFromString(VoiceResponse.serializer(), it)
            }
        }.getOrNull()?.takeIf { it.requestId == requestId }

    private suspend fun respondLocally(text: String) {
        val invocation = VoiceCommandParser.parse(text)
        if (invocation == null) {
            _state.value = UiState.Error("Phone unreachable — try a simpler command.")
            return
        }
        when (val result = services.toolExecutor.execute(invocation)) {
            is GuardianResult.Ok -> _state.value = UiState.Responding(result.value.text, result.value.kind)
            is GuardianResult.Err -> _state.value = UiState.Error(result.message)
        }
    }

    fun dismissResponse() {
        _state.value = UiState.Idle
    }

    private companion object {
        const val RESPONSE_TIMEOUT_MS = 15_000L
    }
}
