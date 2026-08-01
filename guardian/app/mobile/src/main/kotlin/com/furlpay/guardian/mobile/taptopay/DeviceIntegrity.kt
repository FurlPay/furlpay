package com.furlpay.guardian.mobile.taptopay

import com.furlpay.guardian.domain.taptopay.TapToPayUnavailable

// ---------------------------------------------------------------------------
// Device attestation for contactless acceptance.
//
// WHY THIS EXISTS AND iOS HAS NO EQUIVALENT FILE. Apple gates Tap to Pay with a
// granted entitlement and the Secure Element, so trust is established before
// the app runs. Android has no such gate: any APK can ask for NFC. PCI MPoC
// therefore requires the solution to attest, at transaction time, that the
// device is not rooted and the app is the unmodified build that was certified.
//
// The Play Integrity API is how that is done. Stripe's own Tap to Pay SDK uses
// it for exactly this — to verify the app is unmodified and was installed from
// a trusted source — and Google positions it as the mechanism that helps meet
// MPoC.
//
// WHAT THIS FILE IS NOT. It is not a security boundary on its own. A verdict
// computed on the device and trusted by the device is worth nothing; the token
// must be sent to a BACKEND that decodes it against Google's servers. So the
// contract below returns a token to forward, never a local boolean "we are
// fine". The PSP SDK normally owns this end to end — this interface exists so
// the app can fail closed before one is wired, and so the refusal has honest
// copy attached.
// ---------------------------------------------------------------------------

/**
 * The outcome of an attestation attempt.
 *
 * There is deliberately no `Trusted` case carrying a local boolean. Trust is a
 * server's conclusion, not a client's claim.
 */
sealed interface IntegrityOutcome {

    /**
     * A token was obtained. It is opaque and must be forwarded to the backend
     * (or the PSP SDK) for decoding — this app cannot and must not interpret it.
     */
    data class Token(val value: String) : IntegrityOutcome

    /** Attestation could not run or was refused. */
    data class Failed(val detail: String?) : IntegrityOutcome

    /** No attestation provider is wired. The state this repo is in today. */
    data object NotConfigured : IntegrityOutcome
}

interface DeviceIntegrityProvider {
    /**
     * Requests a fresh attestation token.
     *
     * [nonce] must be server-generated and single-use. A client-chosen nonce
     * lets a captured token be replayed, which defeats the whole exercise.
     */
    suspend fun attest(nonce: String): IntegrityOutcome
}

/**
 * The provider in force today.
 *
 * Returns [IntegrityOutcome.NotConfigured], which the service treats as a
 * REFUSAL. That is the deliberate choice: on a platform where any APK can ask
 * for NFC, "we could not check" and "the device is fine" are not the same
 * answer, and only one of them is safe to act on.
 */
object UnconfiguredIntegrityProvider : DeviceIntegrityProvider {
    override suspend fun attest(nonce: String): IntegrityOutcome = IntegrityOutcome.NotConfigured
}

/** Maps an attestation outcome onto the merchant-facing refusal. */
fun IntegrityOutcome.asUnavailable(): TapToPayUnavailable? = when (this) {
    is IntegrityOutcome.Token -> null
    is IntegrityOutcome.Failed -> TapToPayUnavailable.IntegrityFailed(detail)
    IntegrityOutcome.NotConfigured -> TapToPayUnavailable.NoProvider
}
