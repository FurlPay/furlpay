package com.furlpay.sdk.api

import com.furlpay.sdk.internal.FurlPayHttpClient
import com.furlpay.sdk.models.Payment
import com.furlpay.sdk.models.CreatePaymentParams
import io.ktor.http.HttpMethod

class PaymentsApi internal constructor(private val client: FurlPayHttpClient) {
    
    suspend fun create(params: CreatePaymentParams): Payment {
        return client.request(HttpMethod.Post, "/v1/payments", params)
    }

    suspend fun get(id: String): Payment {
        return client.request(HttpMethod.Get, "/v1/payments/$id")
    }

    // Stub for list, refunds
    suspend fun refund(id: String): Payment {
        return client.request(HttpMethod.Post, "/v1/payments/$id/refund")
    }
}
