package com.furlpay.sdk.models

import kotlinx.serialization.Serializable

@Serializable
data class CreatePaymentParams(
    val amount: Double,
    val currency: String,
    val merchantId: String,
    val memo: String? = null,
    val metadata: Map<String, String>? = null,
    val redirectUrl: String? = null
)
