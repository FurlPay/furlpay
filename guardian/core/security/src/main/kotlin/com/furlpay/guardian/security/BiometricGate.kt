package com.furlpay.guardian.security

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The human-in-the-loop gate for mutating GuardianTools. Every dispatch of a
 * tool in `GuardianTools.mutating` — and every ActionDispatcher call — MUST
 * pass through [confirm] first. Same rule the RN co-pilot enforces.
 *
 * BIOMETRIC_STRONG with device-credential fallback: an action the user can't
 * confirm is an action that doesn't happen, not one that silently proceeds.
 */
class BiometricGate {

    sealed interface Outcome {
        data object Confirmed : Outcome
        data object Dismissed : Outcome
        data class Unavailable(val reason: String) : Outcome
    }

    fun available(activity: FragmentActivity): Boolean =
        BiometricManager.from(activity)
            .canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

    suspend fun confirm(
        activity: FragmentActivity,
        title: String,
        subtitle: String? = null,
    ): Outcome {
        val status = BiometricManager.from(activity).canAuthenticate(AUTHENTICATORS)
        if (status != BiometricManager.BIOMETRIC_SUCCESS) {
            return Outcome.Unavailable("Biometric/credential unavailable (code $status)")
        }

        return suspendCancellableCoroutine { continuation ->
            val prompt = BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (continuation.isActive) continuation.resume(Outcome.Confirmed)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (continuation.isActive) continuation.resume(Outcome.Dismissed)
                    }
                    // onAuthenticationFailed = wrong finger, prompt stays up — no resume.
                },
            )

            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .apply { subtitle?.let { setSubtitle(it) } }
                .setAllowedAuthenticators(AUTHENTICATORS)
                .setConfirmationRequired(true)
                .build()

            prompt.authenticate(info)
            continuation.invokeOnCancellation { prompt.cancelAuthentication() }
        }
    }

    private companion object {
        const val AUTHENTICATORS = BIOMETRIC_STRONG or DEVICE_CREDENTIAL
    }
}
