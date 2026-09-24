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
    /**
     * Revokes the paired watch's copy of the session.
     *
     * THIS BELONGS HERE, NOT IN A VIEWMODEL. It used to live in
     * DashboardViewModel.signOut(), which meant exactly one of the three
     * sign-out paths performed it:
     *
     *   - the Dashboard "Sign out" button          → cleared the watch
     *   - [onUnauthorized], i.e. any 401 anywhere  → did NOT
     *   - DeleteAccountViewModel.delete()          → did NOT
     *
     * The last is the worst: the server account is gone, and the watch keeps a
     * token plus a full local snapshot of balances, spending and trips. Moving
     * it onto [signOut] puts it on the single path every caller already uses,
     * so a new caller cannot forget it.
     *
     * A suspending lambda rather than a DataLayerManager dependency: :core:sync
     * depends on Play Services, and making :core:security depend on it too
     * would drag the Wearable SDK into a module that is otherwise pure JVM and
     * unit-testable without Robolectric. The app module supplies the lambda.
     *
     * Defaults to a no-op so tests and any future non-paired surface construct
     * this without a watch.
     */
    private val revokeWatchSession: suspend () -> Unit = {},
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

        // Ordered AFTER the local clear, and failure-isolated.
        //
        // The phone's own session must end even when the Data Layer push
        // cannot: the watch may be out of range, its app uninstalled, or Play
        // Services unavailable. Letting a relay failure propagate would leave
        // the user signed in on the device in their hand because a device on
        // their wrist could not be reached — the wrong way round.
        runCatching { revokeWatchSession() }
    }

    /** Wire to FurlPayClient(onUnauthorized = authManager::onUnauthorized). */
    fun onUnauthorized() {
        scope.launch { signOut() }
    }
}
