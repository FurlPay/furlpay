package com.furlpay.guardian.network

/**
 * Where the FurlPay session JWT lives. On-device the implementation is
 * :core:security's Keystore-encrypted store; tests use [InMemoryTokenStore].
 * The network layer never persists tokens itself.
 */
interface TokenStore {
    suspend fun token(): String?
    /** A login/logout transition. This advances the session visible to requests. */
    suspend fun update(token: String?)
    /** Commit a refresh only when the user is still on [expected]. */
    suspend fun replaceIfCurrent(expected: String, replacement: String): Boolean
    /** Do not let a late 401 clear a newer login. */
    suspend fun clearIfCurrent(expected: String): Boolean
}

class InMemoryTokenStore(@Volatile private var value: String? = null) : TokenStore {
    private val lock = Any()

    override suspend fun token(): String? = synchronized(lock) { value }
    override suspend fun update(token: String?) {
        synchronized(lock) { value = token }
    }

    override suspend fun replaceIfCurrent(expected: String, replacement: String): Boolean = synchronized(lock) {
        if (value != expected) return@synchronized false
        value = replacement
        true
    }

    override suspend fun clearIfCurrent(expected: String): Boolean = synchronized(lock) {
        if (value != expected) return@synchronized false
        value = null
        true
    }
}
