package com.furlpay.guardian.network

import com.furlpay.guardian.network.dto.RefreshResponse
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * Assembles the authenticated FurlPay API client. Mirrors the behavior of
 * native-app/lib/api.ts:
 *
 *  - `Authorization: Bearer <session JWT>` from [TokenStore]
 *  - `X-Furlpay-Client` starts with "mobile" — REQUIRED: /auth/refresh only
 *    returns the new token in the body for mobile-* clients (web gets a cookie)
 *  - `X-Correlation-Id` per request, so a user-reported failure can be tied to
 *    the exact server-side log line
 *  - sliding refresh: a request that finds the token inside its last 10 min
 *    first swaps it at POST /auth/refresh, single-flight; refresh failure is
 *    NOT fatal — the request proceeds and the normal 401 path decides
 *  - any authenticated 401 fires [onUnauthorized] so the app forces re-login
 */
class FurlPayClient(
    baseUrl: String = DEFAULT_BASE_URL,
    private val tokenStore: TokenStore,
    private val clientHeader: String = CLIENT_HEADER,
    private val onUnauthorized: () -> Unit = {},
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private val base: HttpUrl = baseUrl.toHttpUrl()

    /** Bare client for the refresh call itself — no interceptors, no recursion. */
    private val refreshHttp = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val refreshLock = Any()

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(SessionInterceptor())
        .build()

    val api: FurlPayApi = Retrofit.Builder()
        .baseUrl(base)
        .client(http)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(FurlPayApi::class.java)

    private inner class SessionInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            var token = runBlocking { tokenStore.token() }
            if (token != null) token = refreshedIfExpiring(token)

            val request = chain.request().newBuilder()
                .header("X-Furlpay-Client", clientHeader)
                .header("X-Correlation-Id", UUID.randomUUID().toString())
                .apply { token?.let { header("Authorization", "Bearer $it") } }
                .build()

            val response = chain.proceed(request)
            if (response.code == 401 && token != null) onUnauthorized()
            return response
        }
    }

    /**
     * Swap an about-to-expire token BEFORE using it (no-op with >10 min left).
     * Single-flight: concurrent requests serialize on [refreshLock]; whoever
     * arrives second re-reads the store and finds a fresh token already there.
     */
    private fun refreshedIfExpiring(token: String): String {
        val exp = tokenExpiryMs(token) ?: return token
        if (exp - nowMs() > REFRESH_MARGIN_MS) return token

        synchronized(refreshLock) {
            val current = runBlocking { tokenStore.token() } ?: return token
            val currentExp = tokenExpiryMs(current)
            if (currentExp != null && currentExp - nowMs() > REFRESH_MARGIN_MS) {
                return current // someone else refreshed while we waited
            }
            try {
                val request = Request.Builder()
                    .url(base.newBuilder().addPathSegments("auth/refresh").build())
                    .post(ByteArray(0).toRequestBody(null))
                    .header("X-Furlpay-Client", clientHeader)
                    .header("Authorization", "Bearer $current")
                    .build()
                refreshHttp.newCall(request).execute().use { res ->
                    if (!res.isSuccessful) return current
                    val body = res.body?.string() ?: return current
                    val refreshed = json.decodeFromString<RefreshResponse>(body)
                    val newToken = refreshed.token ?: return current
                    runBlocking { tokenStore.update(newToken) }
                    return newToken
                }
            } catch (_: Exception) {
                // Offline / already expired / 30-day ceiling: proceed with the
                // old token — the request's own 401 path takes over.
                return current
            }
        }
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://furlpay.com/api/"

        /** Must start with "mobile" — see /auth/refresh's body-token gate. */
        const val CLIENT_HEADER = "mobile-guardian/0.1.0"

        const val REFRESH_MARGIN_MS = 10L * 60 * 1000

        private val json = Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
            // Request DTOs use defaults as documentation ("type": "flights").
            // Without this, kotlinx OMITS default-valued fields and the server
            // silently falls back (travel/search returned STAYS for a flight
            // query — caught on the emulator Jul 17).
            encodeDefaults = true
        }
    }
}
