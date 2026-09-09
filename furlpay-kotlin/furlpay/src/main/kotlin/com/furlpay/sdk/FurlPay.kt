package com.furlpay.sdk

import com.furlpay.sdk.api.CheckoutApi
import com.furlpay.sdk.api.MerchantsApi
import com.furlpay.sdk.api.PaymentsApi
import com.furlpay.sdk.models.Environment
import com.furlpay.sdk.internal.FurlPayHttpClient

class FurlPay(
    apiKey: String,
    environment: Environment = Environment.SANDBOX
) {
    private val baseUrl = when (environment) {
        Environment.PRODUCTION -> "https://api.furlpay.com"
        Environment.SANDBOX -> "https://sandbox.api.furlpay.com"
    }

    private val httpClient = FurlPayHttpClient(apiKey, baseUrl)

    val payments = PaymentsApi(httpClient)
    val checkout = CheckoutApi(httpClient)
    val merchants = MerchantsApi(httpClient)

    // For internal/advanced usage if needed
    internal suspend inline fun <reified T> request(
        method: io.ktor.http.HttpMethod,
        path: String,
        body: Any? = null
    ): T {
        return httpClient.request(method, path, body)
    }
}
