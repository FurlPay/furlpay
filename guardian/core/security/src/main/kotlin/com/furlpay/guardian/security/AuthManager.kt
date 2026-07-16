package com.furlpay.guardian.security

import com.furlpay.guardian.network.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Session state machine (loading → signedOut/signedIn), mirroring the RN
 * app's auth store. FurlPayClient's `onUnauthorized` is wired to
 * [onUnauthorized], so any authenticated 401 anywhere forces re-login.
 */
class AuthManager(
    private val tokenStore: TokenStore,
    private val scope: CoroutineScope,
) {
    sealed interface AuthState {
        data object Loading : AuthState
        data object SignedOut : AuthState
        data object SignedIn : AuthState
    }

    private val _state = MutableStateFlow<AuthState>(AuthState.Loading)
    val state: StateFlow<AuthState> = _state

    init {
        scope.launch {
            _state.value =
                if (tokenStore.token() != null) AuthState.SignedIn else AuthState.SignedOut
        }
    }

    /** Store a session JWT obtained from the FurlPay login/handoff flow. */
    suspend fun signIn(token: String) {
        tokenStore.update(token)
        _state.value = AuthState.SignedIn
    }

    suspend fun signOut() {
        tokenStore.update(null)
        _state.value = AuthState.SignedOut
    }

    /** Wire to FurlPayClient(onUnauthorized = authManager::onUnauthorized). */
    fun onUnauthorized() {
        scope.launch { signOut() }
    }
}
