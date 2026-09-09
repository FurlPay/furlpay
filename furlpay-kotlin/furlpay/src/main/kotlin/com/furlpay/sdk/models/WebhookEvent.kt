package com.furlpay.sdk.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class WebhookEvent(
    val id: String,
    val type: String,
    val data: JsonElement,
    val created: String
)
