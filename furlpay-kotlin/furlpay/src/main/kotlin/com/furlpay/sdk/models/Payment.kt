package com.furlpay.sdk.models

import kotlinx.serialization.Serializable

@Serializable
data class Payment(
    val id: String,
    val status: String,
    val amount: Double,
    val currency: String,
    val merchant: String,
    val payer: String? = null,
    val txSignature: String? = null,
    val createdAt: String,
    val updatedAt: String
)
