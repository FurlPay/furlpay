package com.furlpay.guardian.network

import java.util.Base64
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

/** Fake JWT with the given expiry — payload only; the client never verifies. */
internal fun fakeJwt(expiresAtMs: Long): String {
    val enc = Base64.getUrlEncoder().withoutPadding()
    val header = enc.encodeToString("""{"alg":"HS256"}""".toByteArray())
    val payload = enc.encodeToString("""{"sub":"u1","exp":${expiresAtMs / 1000}}""".toByteArray())
    return "$header.$payload.sig"
}

class FurlPayClientTest {

    private lateinit var server: MockWebServer

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @AfterTest
    fun tearDown() {
        server.shutdown()
    }

    private fun client(
        store: TokenStore,
        onUnauthorized: () -> Unit = {},
    ) = FurlPayClient(
        baseUrl = server.url("/api/").toString(),
        tokenStore = store,
        onUnauthorized = onUnauthorized,
    )

    @Test
    fun `requests carry bearer, client header, and a correlation id`() = runTest {
        val token = fakeJwt(System.currentTimeMillis() + 60 * 60 * 1000) // fresh
        server.enqueue(MockResponse().setBody("""{"balances":[]}"""))

        client(InMemoryTokenStore(token)).api.wallets()

        val recorded = server.takeRequest()
        assertEquals("/api/wallets", recorded.path)
        assertEquals("Bearer $token", recorded.getHeader("Authorization"))
        assertEquals(FurlPayClient.CLIENT_HEADER, recorded.getHeader("X-Furlpay-Client"))
        assertTrue(recorded.getHeader("X-Furlpay-Client")!!.startsWith("mobile"))
        assertFalse(recorded.getHeader("X-Correlation-Id").isNullOrBlank())
    }

    @Test
    fun `expiring token is swapped at auth-refresh before the request`() = runTest {
        val old = fakeJwt(System.currentTimeMillis() + 5 * 60 * 1000) // inside margin
        val fresh = fakeJwt(System.currentTimeMillis() + 60 * 60 * 1000)
        val store = InMemoryTokenStore(old)

        server.enqueue(MockResponse().setBody("""{"refreshed":true,"token":"$fresh"}"""))
        server.enqueue(MockResponse().setBody("""{"balances":[]}"""))

        client(store).api.wallets()

        val refreshReq = server.takeRequest()
        assertEquals("/api/auth/refresh", refreshReq.path)
        assertEquals("POST", refreshReq.method)
        assertEquals("Bearer $old", refreshReq.getHeader("Authorization"))

        val walletsReq = server.takeRequest()
        assertEquals("/api/wallets", walletsReq.path)
        assertEquals("Bearer $fresh", walletsReq.getHeader("Authorization"))
        assertEquals(fresh, store.token()) // durably stored
    }

    @Test
    fun `fresh token does not trigger a refresh`() = runTest {
        val token = fakeJwt(System.currentTimeMillis() + 60 * 60 * 1000)
        server.enqueue(MockResponse().setBody("""{"balances":[]}"""))

        client(InMemoryTokenStore(token)).api.wallets()

        assertEquals(1, server.requestCount)
        assertEquals("/api/wallets", server.takeRequest().path)
    }

    @Test
    fun `failed refresh is not fatal — request proceeds with the old token`() = runTest {
        val old = fakeJwt(System.currentTimeMillis() + 5 * 60 * 1000)
        server.enqueue(MockResponse().setResponseCode(500)) // refresh breaks
        server.enqueue(MockResponse().setBody("""{"balances":[]}"""))

        client(InMemoryTokenStore(old)).api.wallets()

        server.takeRequest() // refresh attempt
        assertEquals("Bearer $old", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `authenticated 401 fires the unauthorized hook`() = runTest {
        val token = fakeJwt(System.currentTimeMillis() + 60 * 60 * 1000)
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"expired"}"""))

        var fired = false
        val failure = runCatching { client(InMemoryTokenStore(token)) { fired = true }.api.wallets() }

        assertTrue(failure.isFailure)
        assertTrue(fired)
    }

    @Test
    fun `anonymous requests are sent without a bearer and never fire the hook`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"no session"}"""))

        var fired = false
        runCatching { client(InMemoryTokenStore(null)) { fired = true }.api.wallets() }

        assertNotNull(server.takeRequest().getHeader("X-Correlation-Id"))
        assertFalse(fired)
    }
}
