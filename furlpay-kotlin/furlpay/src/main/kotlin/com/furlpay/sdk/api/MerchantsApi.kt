package com.furlpay.sdk.api

import com.furlpay.sdk.internal.FurlPayHttpClient
import com.furlpay.sdk.models.MerchantBalance
import io.ktor.http.HttpMethod

class MerchantsApi internal constructor(private val client: FurlPayHttpClient) {
    suspend fun getBalance(): MerchantBalance {
        return client.request(HttpMethod.Get, "/v1/merchant/balance")
    }
}
