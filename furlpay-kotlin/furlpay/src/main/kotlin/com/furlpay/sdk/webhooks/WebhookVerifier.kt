package com.furlpay.sdk.webhooks

import com.furlpay.sdk.errors.WebhookException
import com.furlpay.sdk.models.WebhookEvent
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.abs

object WebhookVerifier {
    private val json = Json { ignoreUnknownKeys = true }

    fun verify(body: String, signatureHeader: String, secret: String, toleranceSec: Long = 300): Boolean {
        try {
            val parts = signatureHeader.split(",")
            var timestamp = ""
            var sig = ""

            for (part in parts) {
                val kv = part.split("=")
                if (kv.size == 2) {
                    when (kv[0]) {
                        "t" -> timestamp = kv[1]
                        "v1" -> sig = kv[1]
                    }
                }
            }

            if (timestamp.isEmpty() || sig.isEmpty()) return false

            val timeDiff = abs(System.currentTimeMillis() / 1000 - timestamp.toLong())
            if (timeDiff > toleranceSec) return false

            val signedPayload = "$timestamp.$body"
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
            
            val expectedSignatureBytes = mac.doFinal(signedPayload.toByteArray())
            val actualSignatureBytes = hexStringToByteArray(sig)

            return MessageDigest.isEqual(expectedSignatureBytes, actualSignatureBytes)
        } catch (e: Exception) {
            return false
        }
    }

    fun constructEvent(body: String, signatureHeader: String, secret: String): WebhookEvent {
        if (!verify(body, signatureHeader, secret)) {
            throw WebhookException("Invalid webhook signature")
        }
        return json.decodeFromString(WebhookEvent.serializer(), body)
    }

    private fun hexStringToByteArray(s: String): ByteArray {
        val len = s.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = ((Character.digit(s[i], 16) shl 4) + Character.digit(s[i + 1], 16)).toByte()
            i += 2
        }
        return data
    }
}
