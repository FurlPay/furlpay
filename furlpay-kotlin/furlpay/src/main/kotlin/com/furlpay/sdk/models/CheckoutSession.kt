package com.furlpay.sdk.models

import kotlinx.serialization.Serializable

@Serializable
data class CheckoutSession(
    val id: String,
    val url: String,
    val paymentId: String,
    val expiresAt: String
)
