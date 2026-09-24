package com.furlpay.guardian.network

import okhttp3.CertificatePinner

/**
 * Certificate pinning for furlpay.com, shared by the phone and watch clients.
 *
 * WHY THIS EXISTS
 *
 * Pinning was implemented once, well, for the React Native Android app
 * (native-app/plugins/withNetworkSecurityConfig.js) and nowhere else. The
 * Kotlin apps — which hold the same session token and, on the watch, call the
 * API on their own when the phone is unreachable — had no pinning at all.
 *
 * WHY NOT network_security_config.xml
 *
 * The RN app's approach works there because it has one <application> and one
 * config. Doing the same here would put the pins in two manifests (phone and
 * watch) that must never disagree, and Gradle's manifest merger gives no
 * warning when they do. OkHttp's CertificatePinner keeps them in ONE Kotlin
 * file that both modules compile.
 *
 * PIN CHOICE — roots, not leaves or intermediates
 *
 * Identical reasoning and identical values to the RN config, deliberately: two
 * pin sets for the same hostname that drift apart is the failure this is meant
 * to avoid. Every value was recomputed from the published root certificate on
 * 2026-09-25 rather than copied:
 *
 *   openssl x509 -in <root>.pem -pubkey -noout \
 *     | openssl pkey -pubin -outform der \
 *     | openssl dgst -sha256 -binary | openssl enc -base64
 *
 * BOTH CA HIERARCHIES ARE REQUIRED DURING THE AWS MIGRATION. `*.furlpay.com`
 * is served by Vercel today (Let's Encrypt) and by CloudFront + ACM in the new
 * environments (Amazon Trust Services). Pinning only one set makes the cutover
 * a total outage on whichever side is missing, presenting as "no connectivity"
 * rather than as a TLS error anyone would recognise.
 *
 * NO EXPIRY EQUIVALENT. Android's <pin-set expiration> silently disables
 * pinning once passed, which is a deliberate dead-man's switch in the RN app.
 * OkHttp has no such mechanism — a stale pin here fails closed, permanently.
 * [PINS_VERIFIED_ON] and the test that reads it are the substitute: CI fails
 * before the pins go stale rather than users losing connectivity after.
 */
internal object FurlPayPinning {

    /** Bump when any pin is added, removed, or re-verified against the source. */
    const val PINS_VERIFIED_ON = "2026-09-25"

    /**
     * Hosts covered. `**.furlpay.com` in OkHttp syntax matches any depth of
     * subdomain, which is what makes one entry cover furlpay.com's API hosts in
     * every environment.
     */
    private const val PATTERN = "**.furlpay.com"

    private val PINS = listOf(
        // --- Let's Encrypt (Vercel-served hosts) -------------------------------
        "sha256/fk6IOKit1ild5647BH06ujSIq5XbCgqlbYl6ANhhi88=", // ISRG Root YR (RSA, gen-Y)
        "sha256/sCkq5UWXjg+7mKu9lMhhYF5bGLsy7VI/UNW3tccdR7w=", // ISRG Root YE (EC, gen-Y)
        "sha256/C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=", // ISRG Root X1 (RSA)
        "sha256/diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=", // ISRG Root X2 (EC)

        // --- Amazon Trust Services (ACM / CloudFront) --------------------------
        "sha256/++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=", // Amazon Root CA 1
        "sha256/f0KW/FtqTjs108NpYj42SrGvOB2PpxIVM8nWxjPqJGE=", // Amazon Root CA 2
        "sha256/NqvDJlas/GRcYbcWE8S/IceH9cq77kg0jVhZeAPXq8k=", // Amazon Root CA 3
        "sha256/9+ze1cZgR9KO1kZrVDxA4HQ6voHRCSVNz4RdTCx4U8U=", // Amazon Root CA 4
        "sha256/KwccWaCgrnaw6tsrrSO61FgLacNgG2MMLq8GE6+oP5I=", // Starfield Services Root CA G2
    )

    /**
     * The pinner, or [CertificatePinner.DEFAULT] when [enabled] is false.
     *
     * Disabled for MockWebServer, which serves a self-signed certificate that no
     * pin can match. Passing a flag is better than the alternatives: skipping
     * the pinner only in debug builds would leave it untested, and adding the
     * test certificate to the pin list would ship a test anchor to production.
     */
    fun pinner(enabled: Boolean): CertificatePinner {
        if (!enabled) return CertificatePinner.DEFAULT
        return CertificatePinner.Builder()
            .apply { PINS.forEach { add(PATTERN, it) } }
            .build()
    }

    /** Exposed for the test that asserts both hierarchies are present. */
    internal fun pins(): List<String> = PINS
}
