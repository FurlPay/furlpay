package com.furlpay.sdk

import com.furlpay.sdk.webhooks.WebhookVerifier
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.assertFalse

class WebhookVerifierTest {
    @Test
    fun testInvalidSignature() {
        val result = WebhookVerifier.verify("{}", "t=123,v1=invalid", "secret")
        assertFalse(result)
    }
}
