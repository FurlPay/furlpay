package com.furlpay.guardian.network

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * P0-2 (audit 2026-10-05): every production client build pointed at
 * api.furlpay.com, a hostname that has never resolved, so no shipped build
 * could reach a server. The production backend is https://furlpay.com/api.
 *
 * The base URL lives in four files across three toolchains (two Gradle flavors,
 * an Xcode config, an Expo config). Nothing at runtime notices a disagreement
 * until a user cannot sign in, so this pins all four to the same host, and keeps
 * the client default identical.
 *
 * Gradle runs unit tests with the module directory (guardian/core/network) as
 * the working directory.
 */
class ReleaseApiBaseTest {
    private val repo = File("../../..").canonicalFile

    private fun read(path: String): String = File(repo, path).readText()

    /** The body of a `create("prod") { ... }` flavor block. */
    private fun prodFlavor(gradle: String): String {
        val start = gradle.indexOf("create(\"prod\")")
        assertTrue(start >= 0, "no prod flavor found")
        val open = gradle.indexOf('{', start)
        var depth = 0
        for (i in open until gradle.length) {
            when (gradle[i]) {
                '{' -> depth++
                '}' -> if (--depth == 0) return gradle.substring(open, i + 1)
            }
        }
        error("unterminated prod flavor block")
    }

    @Test
    fun `both Guardian prod flavors talk to furlpay dot com`() {
        for (module in listOf("guardian/app/mobile/build.gradle.kts", "guardian/app/wear/build.gradle.kts")) {
            // Code only: the explanatory comment in the block names the old host.
            val prod = prodFlavor(read(module)).lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
            assertTrue(
                prod.contains("\"API_BASE_URL\", \"\\\"https://furlpay.com/api/\\\"\""),
                "$module prod flavor must use https://furlpay.com/api/",
            )
            assertFalse(prod.contains("api.furlpay.com"), "$module prod flavor still names the unresolvable host")
        }
    }

    @Test
    fun `iOS prod config and the Expo release base agree`() {
        val xcconfig = read("ios/FurlPayGuardian/Config/Prod.xcconfig")
        assertTrue(Regex("(?m)^FURLPAY_API_HOST = furlpay\\.com$").containsMatchIn(xcconfig))
        val expo = read("native-app/app.config.js")
        assertTrue(expo.contains("const PRODUCTION_API_BASE = \"https://furlpay.com/api\";"))
    }

    @Test
    fun `client default is the production base`() {
        assertEquals("https://furlpay.com/api/", FurlPayClient.DEFAULT_BASE_URL)
    }
}
