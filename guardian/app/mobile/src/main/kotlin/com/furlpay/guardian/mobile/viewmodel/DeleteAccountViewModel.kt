package com.furlpay.guardian.mobile.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.mobile.mobileServices
import com.furlpay.guardian.network.repo.FurlPayAccountRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * In-app account deletion.
 *
 * Google Play has required this since 2024 for any app that creates accounts,
 * and this app creates one over email OTP. `native-app` and the web dashboard
 * both offered it; this one offered a Sign out button and nothing else, which
 * is a store-review rejection rather than a missing convenience.
 *
 * Three properties, all enforced by the SERVER and mirrored here so the UI
 * cannot promise something different:
 *
 *  1. The retention list comes from GET /api/account, not from copy written
 *     into the app. What the user reads is generated from the same constant the
 *     API enforces, so the screen physically cannot promise an erasure the
 *     server does not perform.
 *  2. Deletion needs a session-bound step-up. DELETE /api/account 403s on a
 *     bare session, so a stolen phone with a live session cannot erase the
 *     account — the user re-verifies with a fresh login code first.
 *  3. Nothing local is cleared until the server confirms. Signing out first
 *     would leave a user believing their account was gone when the request had
 *     not been made.
 *
 * The self-custodial wallet opt-out from the RN screen has no counterpart here:
 * this app holds no recovery phrase, so there is no on-device key material for a
 * deletion to destroy.
 */
class DeleteAccountViewModel(app: Application) : AndroidViewModel(app) {

    /** Where the user is in the flow. Deliberately a single enum — a set of
     *  booleans would let "verifying" and "deleting" both be true. */
    enum class Step {
        /** Reading the preview. */
        Loading,

        /** Showing what goes and what stays; the session is already stepped up. */
        Review,

        /** The session needs a fresh login code before deletion is allowed. */
        NeedsCode,

        /** A code has been sent and is awaited. */
        CodeSent,

        /** DELETE is in flight. */
        Deleting,

        /** Done — the caller returns to the login screen. */
        Deleted,
    }

    data class UiState(
        val step: Step = Step.Loading,
        val retained: List<FurlPayAccountRepository.Retained> = emptyList(),
        /** Where a re-verification code would be sent. Read from the server,
         *  never typed: letting the user name the address would let someone
         *  else's inbox authorise the deletion. */
        val email: String? = null,
        val code: String = "",
        val confirmText: String = "",
        val busy: Boolean = false,
        val error: String? = null,
    ) {
        /** The final button is live only on an exact typed confirmation. A
         *  destructive action reachable in one tap is reached by accident. */
        val armed: Boolean
            get() = step == Step.Review && confirmText.trim().uppercase() == "DELETE" && !busy
    }

    private val services = app.mobileServices
    private val repo = FurlPayAccountRepository(services.client.api)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(step = Step.Loading, error = null)
        viewModelScope.launch {
            when (val preview = repo.preview()) {
                is FurlPayAccountRepository.Preview.Ok ->
                    _state.value = _state.value.copy(
                        step = if (preview.stepUpSatisfied) Step.Review else Step.NeedsCode,
                        retained = preview.retained,
                        email = preview.email,
                        error = null,
                    )

                // Fail to NeedsCode, never to Review: a preview that could not
                // be read must not present itself as a session cleared to
                // delete.
                is FurlPayAccountRepository.Preview.Failed ->
                    _state.value = _state.value.copy(
                        step = Step.NeedsCode,
                        error = preview.message,
                    )
            }
        }
    }

    fun onCodeChanged(value: String) {
        _state.value = _state.value.copy(code = value, error = null)
    }

    fun onConfirmTextChanged(value: String) {
        _state.value = _state.value.copy(confirmText = value, error = null)
    }

    fun sendCode() {
        val email = _state.value.email
        if (email.isNullOrBlank()) {
            _state.value = _state.value.copy(
                error = "Sign out and sign in again, then return here.",
            )
            return
        }
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            val failure = repo.sendVerificationCode(email)
            _state.value = _state.value.copy(
                busy = false,
                step = if (failure == null) Step.CodeSent else _state.value.step,
                error = failure,
            )
        }
    }

    fun verifyCode() {
        val current = _state.value
        val email = current.email
        if (current.code.trim().length < 4 || email.isNullOrBlank()) {
            _state.value = current.copy(error = "Enter the code from your email.")
            return
        }
        _state.value = current.copy(busy = true, error = null)
        viewModelScope.launch {
            repo.verifyCode(email, current.code.trim())
                .onSuccess { token ->
                    // Store the NEW session before the delete: the step-up is
                    // bound to that session's jti, so deleting on the old one
                    // would 403 even though the user just verified.
                    services.authManager.signIn(token)
                    _state.value = _state.value.copy(busy = false, step = Step.Review, code = "")
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        busy = false,
                        error = e.message ?: "Verification failed.",
                    )
                }
        }
    }

    /** Irreversible. Only reachable from [UiState.armed]. */
    fun delete() {
        if (!_state.value.armed) return
        _state.value = _state.value.copy(step = Step.Deleting, busy = true, error = null)
        viewModelScope.launch {
            when (val outcome = repo.delete()) {
                FurlPayAccountRepository.Deletion.Deleted -> {
                    // Local teardown only AFTER the server confirms. The session
                    // it used is already revoked server-side.
                    services.authManager.signOut()
                    _state.value = _state.value.copy(step = Step.Deleted, busy = false)
                }

                // The window closed mid-flow. Send the user back through it
                // rather than leaving a confirm button that cannot work.
                FurlPayAccountRepository.Deletion.StepUpRequired ->
                    _state.value = _state.value.copy(
                        step = Step.NeedsCode,
                        busy = false,
                        confirmText = "",
                        error = "Re-verify your identity, then confirm deletion.",
                    )

                is FurlPayAccountRepository.Deletion.Failed ->
                    _state.value = _state.value.copy(
                        step = Step.Review,
                        busy = false,
                        confirmText = "",
                        error = outcome.message,
                    )
            }
        }
    }
}
