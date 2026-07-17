package com.furlpay.guardian.mobile.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.ai.GeminiLiveAssistant
import com.furlpay.guardian.mobile.mobileServices
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Live bidirectional voice (mic → Gemini → speaker). The session is bound to
 * this screen: leaving it tears the session down — no background listening,
 * ever. Read-only by construction (GeminiLiveAssistant declares no tools).
 */
class LiveVoiceViewModel(app: Application) : AndroidViewModel(app) {

    sealed interface UiState {
        data object Idle : UiState
        data object Connecting : UiState
        data object Live : UiState
        data class Error(val message: String) : UiState
    }

    private val _state = MutableStateFlow<UiState>(UiState.Idle)
    val state = _state.asStateFlow()

    /** Built lazily — the constructor touches FirebaseApp. */
    private var assistant: GeminiLiveAssistant? = null

    /** Caller must hold RECORD_AUDIO (the screen requests it before calling). */
    fun start() {
        val current = _state.value
        if (current is UiState.Connecting || current is UiState.Live) return
        if (!getApplication<Application>().mobileServices.firebaseConfigured) {
            _state.value = UiState.Error(
                "Voice chat needs the Firebase config baked into this build.",
            )
            return
        }
        _state.value = UiState.Connecting
        viewModelScope.launch {
            runCatching {
                (assistant ?: GeminiLiveAssistant().also { assistant = it }).start()
            }.onSuccess {
                _state.value = UiState.Live
            }.onFailure {
                _state.value = UiState.Error(
                    it.message ?: "Couldn't reach Gemini — try again.",
                )
            }
        }
    }

    fun stop() {
        viewModelScope.launch {
            runCatching { assistant?.stop() }
            _state.value = UiState.Idle
        }
    }

    override fun onCleared() {
        // viewModelScope is already cancelled here — detached cleanup.
        val live = assistant ?: return
        CoroutineScope(Dispatchers.IO).launch { runCatching { live.stop() } }
    }
}
