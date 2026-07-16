package com.furlpay.guardian.mobile.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.mobile.mobileServices
import com.furlpay.guardian.network.dto.OtpCheckRequest
import com.furlpay.guardian.network.dto.OtpStartRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Email OTP against the live /api/auth/otp/{start,check}. On success the
 * session token lands in the Keystore store AND is pushed to the watch.
 */
class SignInViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val email: String = "",
        val code: String = "",
        val codeSent: Boolean = false,
        val busy: Boolean = false,
        val error: String? = null,
    )

    private val services = app.mobileServices

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    fun onEmailChanged(value: String) {
        _state.value = _state.value.copy(email = value, error = null)
    }

    fun onCodeChanged(value: String) {
        _state.value = _state.value.copy(code = value, error = null)
    }

    fun reset() {
        _state.value = UiState(email = _state.value.email)
    }

    fun sendCode() {
        val email = _state.value.email.trim()
        if ("@" !in email || email.length < 5) {
            _state.value = _state.value.copy(error = "Enter a valid email.")
            return
        }
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching {
                services.client.api.otpStart(OtpStartRequest(to = email, channel = "email"))
            }.onSuccess {
                _state.value = _state.value.copy(busy = false, codeSent = true)
            }.onFailure { e ->
                _state.value = _state.value.copy(
                    busy = false,
                    error = e.message ?: "Couldn't send the code.",
                )
            }
        }
    }

    fun verifyCode() {
        val current = _state.value
        if (current.code.length < 4) {
            _state.value = current.copy(error = "Enter the code from your email.")
            return
        }
        _state.value = current.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching {
                services.client.api.otpCheck(
                    OtpCheckRequest(to = current.email.trim(), code = current.code.trim()),
                )
            }.onSuccess { response ->
                val token = response.token
                if (response.verified && token != null) {
                    services.authManager.signIn(token)
                    services.sync.pushToken() // watch gets the session immediately
                    _state.value = UiState()
                } else {
                    _state.value = _state.value.copy(busy = false, error = "Incorrect code.")
                }
            }.onFailure { e ->
                _state.value = _state.value.copy(
                    busy = false,
                    error = e.message ?: "Verification failed.",
                )
            }
        }
    }
}
