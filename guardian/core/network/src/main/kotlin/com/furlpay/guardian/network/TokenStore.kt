package com.furlpay.guardian.network

/**
 * Where the FurlPay session JWT lives. On-device the implementation is
 * :core:security's Keystore-encrypted store; tests use [InMemoryTokenStore].
 * The network layer never persists tokens itself.
 */
interface TokenStore {
    suspend fun token(): String?
    suspend fun update(token: String?)
}

class InMemoryTokenStore(@Volatile private var value: String? = null) : TokenStore {
    override suspend fun token(): String? = value
    override suspend fun update(token: String?) {
        value = token
    }
}
