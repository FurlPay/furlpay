package com.furlpay.sdk.models

import kotlinx.serialization.Serializable

@Serializable
data class MerchantBalance(
    val available: Double,
    val pending: Double,
    val currency: String
)
