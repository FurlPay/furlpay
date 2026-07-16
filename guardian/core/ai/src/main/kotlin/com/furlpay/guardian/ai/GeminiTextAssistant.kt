package com.furlpay.guardian.ai

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.ai.GuardianTool
import com.furlpay.guardian.domain.ai.GuardianToolExecutor
import com.furlpay.guardian.domain.ai.GuardianTools
import com.furlpay.guardian.domain.ai.ParamType
import com.furlpay.guardian.domain.ai.ToolInvocation
import com.furlpay.guardian.domain.ai.ToolReply
import com.google.firebase.Firebase
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.FunctionDeclaration
import com.google.firebase.ai.type.FunctionResponsePart
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.Schema
import com.google.firebase.ai.type.Tool
import com.google.firebase.ai.type.content
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Text-in/text-out Gemini path (watch relay + phone chat). The tool surface
 * is GuardianTools — the SAME catalog the rule-based parser uses — and every
 * call the model makes funnels through [GuardianToolExecutor], which owns the
 * mutating-tool confirmation gate. The model proposes; it never executes.
 *
 * Requires a configured FirebaseApp (google-services.json) at runtime.
 */
class GeminiTextAssistant(
    private val executor: GuardianToolExecutor,
    modelName: String = MODEL,
) {
    private val model = Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = modelName,
        tools = listOf(Tool.functionDeclarations(GuardianTools.all.map { it.toDeclaration() })),
        systemInstruction = content { text(GuardianSystemPrompt.TEXT) },
    )

    private val chat = model.startChat()

    suspend fun ask(userMessage: String): ToolReply {
        return try {
            var response = chat.sendMessage(userMessage)
            var lastToolKind = "generic"

            // Tool loop — bounded so a misbehaving model can't spin forever.
            var rounds = 0
            while (rounds < MAX_TOOL_ROUNDS) {
                val calls = response.functionCalls
                if (calls.isEmpty()) break
                val responseParts = calls.map { call ->
                    val tool = GuardianTools.byName(call.name)
                    val reply = if (tool == null) {
                        ToolReply("Unknown tool.", "error")
                    } else {
                        val args = call.args
                            .mapNotNull { (k, v) ->
                                (v as? JsonPrimitive)?.content?.let { k to it }
                            }
                            .toMap()
                        when (val result = executor.execute(ToolInvocation(tool, args))) {
                            is GuardianResult.Ok -> result.value
                            is GuardianResult.Err -> ToolReply(result.message, "error")
                        }
                    }
                    lastToolKind = reply.kind
                    FunctionResponsePart(
                        call.name,
                        buildJsonObject {
                            put("result", reply.text)
                            put("kind", reply.kind)
                        },
                    )
                }
                response = chat.sendMessage(
                    content(role = "function") { responseParts.forEach { part(it) } },
                )
                rounds++
            }

            ToolReply(
                text = response.text?.trim().takeUnless { it.isNullOrBlank() }
                    ?: "I couldn't process that. Try again.",
                kind = lastToolKind,
            )
        } catch (e: Exception) {
            ToolReply("I can't check that right now. Try again in a moment.", "error")
        }
    }

    private fun GuardianTool.toDeclaration() = FunctionDeclaration(
        name = name,
        description = description,
        parameters = params.associate { p ->
            p.name to when (p.type) {
                ParamType.STRING -> Schema.string(description = p.description)
                ParamType.BOOLEAN -> Schema.boolean(description = p.description)
                ParamType.INTEGER -> Schema.integer(description = p.description)
            }
        },
        optionalParameters = params.filter { !it.required }.map { it.name },
    )

    companion object {
        const val MODEL = "gemini-2.5-flash"
        private const val MAX_TOOL_ROUNDS = 4
    }
}
