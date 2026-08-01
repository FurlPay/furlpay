package com.furlpay.guardian.mobile.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.taptopay.TapToPayAvailability
import com.furlpay.guardian.domain.taptopay.TapToPayCharge
import com.furlpay.guardian.domain.taptopay.TapToPayFailure
import com.furlpay.guardian.domain.taptopay.TapToPayProvider
import com.furlpay.guardian.domain.taptopay.TapToPayResult
import com.furlpay.guardian.domain.taptopay.TapToPayUnavailable
import com.furlpay.guardian.domain.taptopay.UnconfiguredTapToPayProvider
import com.furlpay.guardian.mobile.taptopay.DeviceIntegrityProvider
import com.furlpay.guardian.mobile.taptopay.TapToPayEnvironment
import com.furlpay.guardian.mobile.taptopay.UnconfiguredIntegrityProvider
import com.furlpay.guardian.mobile.taptopay.asUnavailable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.math.BigDecimal
import java.util.UUID

/**
 * The merchant terminal. Mirrors TapToPayService.swift phase for phase, so the
 * two platforms behave identically at the counter.
 *
 * ORDER OF CHECKS, WHICH IS NOT ARBITRARY:
 *   1. Device — NFC present, NFC on, Android 12+. Free, and permanent answers.
 *   2. Attestation — PCI MPoC requires it, and it is the one refusal that must
 *      never be overridable.
 *   3. The PSP — onboarding, region, terminal configuration.
 *   4. Scheme terms.
 *   5. The tap.
 *
 * Running the PSP call first would mean a network round trip to tell someone
 * their phone has no NFC radio.
 */
class TapToPayViewModel @JvmOverloads constructor(
    app: Application,
    private val provider: TapToPayProvider = UnconfiguredTapToPayProvider,
    private val integrity: DeviceIntegrityProvider = UnconfiguredIntegrityProvider,
    private val environment: TapToPayEnvironment = TapToPayEnvironment.from(app),
) : AndroidViewModel(app) {
    // @JvmOverloads is load-bearing, not decoration. Compose's `viewModel()`
    // uses the default AndroidViewModel factory, which reflects for a
    // constructor taking exactly `Application`. Kotlin default arguments do NOT
    // generate one, so without this the screen compiles and then throws
    // "Cannot create an instance of class TapToPayViewModel" the first time a
    // merchant opens it. The other parameters exist so tests can inject.

    sealed interface Phase {
        data object Idle : Phase
        data object Preparing : Phase

        /** The PSP's sheet is up; the customer has not tapped yet. */
        data object WaitingForTap : Phase
        data object Authorising : Phase
        data class Succeeded(val result: TapToPayResult) : Phase
        data class Failed(val message: String, val recoverable: Boolean) : Phase
    }

    data class UiState(
        /** Amount in minor units, till-style. */
        val minorUnits: Long = 0,
        val phase: Phase = Phase.Idle,
        val availability: TapToPayAvailability =
            TapToPayAvailability.Unavailable(TapToPayUnavailable.NoProvider),
    ) {
        val amount: BigDecimal get() = BigDecimal.valueOf(minorUnits, 2)
        val canCharge: Boolean get() = availability.isAvailable && minorUnits > 0
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    /**
     * One key per SALE, reused across retries of that sale. Cleared only by
     * [newSale] — a retry after a network error must carry the same key or the
     * server cannot tell a retry from a second purchase.
     */
    private var idempotencyKey = UUID.randomUUID().toString()

    init {
        refreshAvailability()
    }

    fun refreshAvailability() {
        viewModelScope.launch {
            val local = environment.blocker()
            if (local != null) {
                _state.value = _state.value.copy(
                    availability = TapToPayAvailability.Unavailable(local),
                )
                return@launch
            }
            _state.value = _state.value.copy(availability = provider.availability())
        }
    }

    // ── Till entry ──────────────────────────────────────────────────────────

    /**
     * Digits fill from the right, so 1-2-5 reads $1.25.
     *
     * Kept here rather than in the composable so the arithmetic that decides
     * what a customer is charged is testable without a UI.
     */
    fun press(key: String) {
        val current = _state.value.minorUnits
        val next = when (key) {
            BACKSPACE -> current / 10
            else -> {
                val digit = key.singleOrNull()?.digitToIntOrNull() ?: return
                val candidate = current * 10 + digit
                // Ceiling matches TapToPayCharge.isValid, so a leaning thumb
                // cannot ring up eight figures.
                if (candidate > MAX_MINOR_UNITS) return else candidate
            }
        }
        _state.value = _state.value.copy(minorUnits = next)
    }

    fun newSale() {
        idempotencyKey = UUID.randomUUID().toString()
        _state.value = _state.value.copy(minorUnits = 0, phase = Phase.Idle)
    }

    // ── Collecting ──────────────────────────────────────────────────────────

    fun charge() {
        val charge = TapToPayCharge(
            amount = _state.value.amount,
            reference = "FurlPay sale",
            idempotencyKey = idempotencyKey,
        )
        if (!charge.isValid) {
            fail(TapToPayFailure.InvalidAmount)
            return
        }

        viewModelScope.launch {
            _state.value = _state.value.copy(phase = Phase.Preparing)

            environment.blocker()?.let { fail(TapToPayFailure.Unavailable(it)); return@launch }

            // Attestation. The nonce is a placeholder until a backend issues
            // one — a client-chosen nonce lets a captured token be replayed, so
            // this is a TODO with teeth, not a detail.
            integrity.attest(nonce = UUID.randomUUID().toString()).asUnavailable()?.let {
                fail(TapToPayFailure.Unavailable(it)); return@launch
            }

            when (val availability = provider.availability()) {
                is TapToPayAvailability.Unavailable -> {
                    fail(TapToPayFailure.Unavailable(availability.reason)); return@launch
                }
                TapToPayAvailability.Available -> Unit
            }

            when (val terms = provider.acceptTermsIfNeeded()) {
                is GuardianResult.Err -> {
                    fail(TapToPayFailure.ProviderFailure(terms.message)); return@launch
                }
                is GuardianResult.Ok -> Unit
            }

            _state.value = _state.value.copy(phase = Phase.WaitingForTap)
            when (val result = provider.collect(charge)) {
                is GuardianResult.Ok ->
                    _state.value = _state.value.copy(phase = Phase.Succeeded(result.value))
                is GuardianResult.Err ->
                    fail(TapToPayFailure.ProviderFailure(result.message))
            }
        }
    }

    private fun fail(failure: TapToPayFailure) {
        _state.value = _state.value.copy(
            phase = Phase.Failed(
                message = messageFor(failure),
                recoverable = failure !is TapToPayFailure.Cancelled &&
                    (failure as? TapToPayFailure.Unavailable)?.reason?.isRecoverable ?: true,
            ),
        )
    }

    companion object {
        const val BACKSPACE = "⌫"
        private const val MAX_MINOR_UNITS = 1_000_000L

        /**
         * Merchant-facing copy. Kept as a pure function so the wording is
         * testable, and identical to TapToPayService.message(for:) on iOS.
         *
         * A decline is deliberately NOT phrased as our failure: the merchant is
         * standing in front of the customer, and "something went wrong" invites
         * them to blame the app and retry a card the issuer already refused.
         */
        fun messageFor(failure: TapToPayFailure): String = when (failure) {
            is TapToPayFailure.Unavailable -> detailFor(failure.reason)
            TapToPayFailure.InvalidAmount -> "Enter a valid amount."
            is TapToPayFailure.CardReadFailed ->
                "Card not read. Ask the customer to hold it closer, and hold still."
            is TapToPayFailure.Declined ->
                failure.reason ?: "The card was declined. Ask for another payment method."
            TapToPayFailure.Cancelled -> "Payment cancelled."
            // Unambiguous on purpose. A merchant who is unsure whether it went
            // through will run the card again.
            is TapToPayFailure.Network -> "No connection. The payment wasn't taken."
            is TapToPayFailure.ProviderFailure -> failure.detail
        }

        fun titleFor(reason: TapToPayUnavailable): String = when (reason) {
            TapToPayUnavailable.NoNfc -> "Not supported on this phone"
            TapToPayUnavailable.NfcDisabled -> "Turn on NFC"
            TapToPayUnavailable.OsTooOld -> "Update required"
            is TapToPayUnavailable.IntegrityFailed -> "Can't verify this device"
            is TapToPayUnavailable.RegionNotSupported -> "Not available in your region"
            TapToPayUnavailable.NoProvider -> "Card acceptance isn't set up"
            TapToPayUnavailable.TermsNotAccepted -> "One more step"
            is TapToPayUnavailable.MerchantNotOnboarded -> "Finish setting up payments"
        }

        fun detailFor(reason: TapToPayUnavailable): String = when (reason) {
            TapToPayUnavailable.NoNfc ->
                "Accepting contactless payments needs a phone with NFC."
            TapToPayUnavailable.NfcDisabled ->
                "Switch NFC on to accept contactless payments."
            TapToPayUnavailable.OsTooOld ->
                "Contactless acceptance needs Android 12 or later."
            is TapToPayUnavailable.IntegrityFailed ->
                // Deliberately vague about WHICH check failed. Naming the signal
                // tells someone trying to defeat it exactly what to change.
                "For your customers' safety, payments can only be taken on an " +
                    "unmodified device with the app installed from Google Play."
            is TapToPayUnavailable.RegionNotSupported ->
                reason.region?.let { "Contactless acceptance isn't available in $it yet." }
                    ?: "Contactless acceptance isn't available in your region yet."
            TapToPayUnavailable.NoProvider ->
                "Connect a payment processor to start accepting cards."
            TapToPayUnavailable.TermsNotAccepted ->
                "Accept the payment terms to start taking payments."
            is TapToPayUnavailable.MerchantNotOnboarded ->
                reason.reason ?: "Your payment account is still being verified."
        }
    }
}
