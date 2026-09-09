package com.furlpay.sdk.models

import kotlinx.serialization.Serializable

@Serializable
data class NetworkStatus(
    val health: String,
    val currentTps: Int,
    val medianConfirmationMs: Int,
    val finalityMode: String,
    val alpenglowActive: Boolean
)
