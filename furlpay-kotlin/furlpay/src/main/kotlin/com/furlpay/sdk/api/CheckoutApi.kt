package com.furlpay.sdk.api

import com.furlpay.sdk.internal.FurlPayHttpClient
import com.furlpay.sdk.models.CheckoutSession
import io.ktor.http.HttpMethod

class CheckoutApi internal constructor(private val client: FurlPayHttpClient) {
    suspend fun getSession(id: String): CheckoutSession {
        return client.request(HttpMethod.Get, "/v1/checkout/sessions/$id")
    }
}
