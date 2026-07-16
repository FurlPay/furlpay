package com.furlpay.guardian.ai

import com.google.firebase.Firebase
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.LiveSession
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.ResponseModality
import com.google.firebase.ai.type.SpeechConfig
import com.google.firebase.ai.type.Voice
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.liveGenerationConfig

/**
 * Bidirectional voice (Gemini Live API) — PHONE ONLY. The watch never runs
 * this: it relays text over the Data Layer (see SyncProtocol) to preserve
 * battery. Model + voice names are the ones verified in ARCHITECTURE.md, not
 * the plan doc's. Caller must hold RECORD_AUDIO before [start].
 *
 * Live tool-calling is deliberately NOT wired yet: mutating tools need the
 * biometric gate mid-conversation, and until that interaction is designed the
 * voice session stays read-only-by-construction (no tools declared).
 */
@OptIn(PublicPreviewAPI::class)
class GeminiLiveAssistant {

    private val model = Firebase.ai(backend = GenerativeBackend.googleAI()).liveModel(
        modelName = MODEL,
        generationConfig = liveGenerationConfig {
            responseModality = ResponseModality.AUDIO
            speechConfig = SpeechConfig(voice = Voice(VOICE))
        },
        systemInstruction = content { text(GuardianSystemPrompt.TEXT) },
    )

    private var session: LiveSession? = null

    val active: Boolean get() = session != null

    /** Connect and start mic → Gemini → speaker streaming. */
    suspend fun start() {
        if (session != null) return
        session = model.connect().also { it.startAudioConversation() }
    }

    suspend fun stop() {
        session?.let {
            it.stopAudioConversation()
            it.close()
        }
        session = null
    }

    companion object {
        /** Verified July 2026 (developer.android.com/ai/gemini/live). */
        const val MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
        const val VOICE = "FENRIR"
    }
}
