package com.furlpay.guardian.wear.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.wear.wearServices
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The receive address for the QuickPay QR. Network first (address changes
 * ~never), then the local cache so the QR renders in airplane mode too —
 * the whole point of a receive QR is working when nothing else does.
 */
class QuickPayViewModel(app: Application) : AndroidViewModel(app) {

    data class UiState(
        val loading: Boolean = true,
        val address: String? = null,
        val error: String? = null,
    )

    private val services = app.wearServices

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init {
        viewModelScope.launch {
            val fetched = runCatching { services.client.api.wallets().safeAddress }.getOrNull()
            if (fetched != null) {
                services.snapshots.write(CACHE_KEY, fetched)
                _state.value = UiState(loading = false, address = fetched)
            } else {
                val cached = services.snapshots.read(CACHE_KEY)?.json
                _state.value = if (cached != null) {
                    UiState(loading = false, address = cached)
                } else {
                    UiState(loading = false, error = "Open FurlPay on your phone once to sync your address.")
                }
            }
        }
    }

    private companion object {
        const val CACHE_KEY = "/guardian/safe-address"
    }
}
