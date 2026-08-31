package com.furlpay.guardian.network.repo

import com.furlpay.guardian.network.FurlPayApi
import com.furlpay.guardian.network.dto.OtpCheckRequest
import com.furlpay.guardian.network.dto.OtpStartRequest
import retrofit2.HttpException

/**
 * Account deletion, kept behind the module boundary the rest of `repo` keeps:
 * nothing Retrofit-shaped crosses into a ViewModel. That matters more here than
 * elsewhere, because the outcomes this flow has to distinguish are HTTP status
 * codes — a 403 means "step up again", not "it failed" — and a ViewModel that
 * had to read `HttpException.code()` to tell those apart would need Retrofit on
 * its classpath to be correct.
 */
class FurlPayAccountRepository(private val api: FurlPayApi) {

    /** What deletion would erase, and whether this session may already do it. */
    sealed interface Preview {
        data class Ok(
            val stepUpSatisfied: Boolean,
            val retained: List<Retained>,
            /** Where a re-verification code would be sent, when the profile
             *  route answered. Null only costs the in-place re-verify. */
            val email: String?,
        ) : Preview

        data class Failed(val message: String) : Preview
    }

    data class Retained(val record: String, val reason: String)

    /** The outcome of DELETE /api/account. */
    sealed interface Deletion {
        /** Gone. The server has already revoked the session that did it. */
        data object Deleted : Deletion

        /**
         * The session is not stepped up, or its step-up window closed
         * mid-flow. NOT a failure: the account is untouched and the user only
         * has to re-verify. Distinguishing this from [Failed] is the reason
         * this repository exists.
         */
        data object StepUpRequired : Deletion

        /** Nothing was deleted; the account is unchanged. */
        data class Failed(val message: String) : Deletion
    }

    suspend fun preview(): Preview =
        try {
            val preview = api.accountDeletionPreview()
            Preview.Ok(
                stepUpSatisfied = preview.stepUpSatisfied,
                retained = preview.retained.map { Retained(it.record, it.reason) },
                // Best-effort and deliberately separate: a profile route that
                // fails must not take the whole screen down with it.
                email = runCatching { api.profile().email }.getOrNull(),
            )
        } catch (e: Exception) {
            Preview.Failed(friendly(e, "Could not load your account details."))
        }

    /** Sends a login code to [email]; verifying it is what the server counts
     *  as a step-up (auth/otp/check records one against the new session). */
    suspend fun sendVerificationCode(email: String): String? =
        try {
            api.otpStart(OtpStartRequest(to = email))
            null
        } catch (e: Exception) {
            friendly(e, "Couldn't send the code.")
        }

    /**
     * Verifies the code and returns the NEW session token, or null with a
     * message. The token has to be stored before the delete: the step-up is
     * bound to the new session's jti, so deleting on the old one 403s.
     */
    suspend fun verifyCode(email: String, code: String): Result<String> =
        try {
            val response = api.otpCheck(OtpCheckRequest(to = email, code = code))
            val token = response.token
            if (response.verified && token != null) {
                Result.success(token)
            } else {
                Result.failure(IllegalStateException("Incorrect code."))
            }
        } catch (e: Exception) {
            Result.failure(IllegalStateException(friendly(e, "Verification failed.")))
        }

    /** Irreversible. */
    suspend fun delete(): Deletion =
        try {
            if (api.deleteAccount().deleted) {
                Deletion.Deleted
            } else {
                Deletion.Failed("Deletion did not complete. Your account is unchanged.")
            }
        } catch (e: HttpException) {
            if (e.code() == 403) {
                Deletion.StepUpRequired
            } else {
                Deletion.Failed("Deletion failed. Your account is unchanged.")
            }
        } catch (e: Exception) {
            // A network failure is the case where the app genuinely does not
            // know, so the copy must not claim either outcome.
            Deletion.Failed(
                "Network error — we couldn't reach FurlPay, so your account was not deleted.",
            )
        }

    /** Never surface a raw OkHttp message: it reads as a crash, and on a failed
     *  delete it reads as though something irreversible half-happened. */
    private fun friendly(e: Exception, fallback: String): String =
        if (e is HttpException) fallback else "$fallback Check your connection."
}
