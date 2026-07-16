package com.furlpay.guardian.network

import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * `exp` (ms) from a JWT WITHOUT verifying it — the server re-verifies every
 * request anyway; the client only needs a clock to schedule the sliding
 * refresh. Mirrors native-app/lib/api.ts::tokenExpiryMs. Must never throw.
 */
fun tokenExpiryMs(token: String): Long? {
    val payload = token.split(".").getOrNull(1) ?: return null
    return try {
        val bytes = Base64.getUrlDecoder().decode(payload)
        val obj = Json.parseToJsonElement(bytes.decodeToString()) as? JsonObject ?: return null
        obj["exp"]?.jsonPrimitive?.longOrNull?.let { it * 1000 }
    } catch (_: Exception) {
        null
    }
}
