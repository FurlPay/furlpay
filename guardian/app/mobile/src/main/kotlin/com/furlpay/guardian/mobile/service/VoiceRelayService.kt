package com.furlpay.guardian.mobile.service

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.ai.ToolReply
import com.furlpay.guardian.domain.ai.VoiceCommandParser
import com.furlpay.guardian.mobile.mobileServices
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.sync.VoiceCommand
import com.furlpay.guardian.sync.VoiceResponse
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.runBlocking

/**
 * Phone side of the watch voice pipeline:
 *
 *   watch SpeechRecognizer → MessageClient(/guardian/voice-command) → HERE
 *     1. deterministic rule parse (GuardianTools catalog) — fast, offline-safe
 *     2. no rule match + Firebase configured → Gemini (same tool executor)
 *     3. neither → honest "didn't understand"
 *   → DataClient(/guardian/voice-response) → watch response card
 *
 * Mutating tools refuse here by construction (no Activity → no biometric).
 */
class VoiceRelayService : WearableListenerService() {

    override fun onMessageReceived(messageEvent: MessageEvent) {
        val services = applicationContext.mobileServices
        when (messageEvent.path) {
            SyncProtocol.MSG_VOICE_COMMAND -> {
                val command = runCatching {
                    SyncProtocol.json.decodeFromString(
                        VoiceCommand.serializer(),
                        messageEvent.data.decodeToString(),
                    )
                }.getOrNull() ?: return

                // ListenerService callbacks arrive on a background thread.
                runBlocking {
                    val reply = answer(command.text)
                    val response = VoiceResponse(
                        requestId = command.id,
                        text = reply.text,
                        kind = reply.kind,
                        atMs = System.currentTimeMillis(),
                    )
                    runCatching {
                        services.dataLayer.putJson(
                            SyncProtocol.DATA_VOICE_RESPONSE,
                            SyncProtocol.json.encodeToString(VoiceResponse.serializer(), response),
                        )
                    }
                }
            }

            SyncProtocol.MSG_REFRESH_REQUEST -> runBlocking {
                services.sync.pushAll()
            }
        }
    }

    private suspend fun answer(text: String): ToolReply {
        val services = applicationContext.mobileServices

        VoiceCommandParser.parse(text)?.let { invocation ->
            return when (val result = services.relayExecutor.execute(invocation)) {
                is GuardianResult.Ok -> result.value
                is GuardianResult.Err -> ToolReply(result.message, "error")
            }
        }

        return if (services.firebaseConfigured) {
            services.gemini.ask(text)
        } else {
            ToolReply("I didn't catch that — try \"what's my balance\" or \"next flight\".", "error")
        }
    }
}
