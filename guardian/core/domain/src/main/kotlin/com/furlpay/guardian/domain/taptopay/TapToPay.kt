package com.furlpay.guardian.domain.taptopay

import com.furlpay.guardian.domain.GuardianResult
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.UUID

// ---------------------------------------------------------------------------
// Tap to Pay on Android — turning the merchant's phone into a contactless
// terminal. Mirrors ios/FurlPayGuardian/Shared/Domain/TapToPay.swift; the two
// must stay in behavioural lockstep the same way the action registries do.
//
// READ THIS BEFORE EXTENDING ANY OF IT.
//
// There is NO first-party Google API for this. That is the single biggest
// difference from iOS, where Apple ships ProximityReader. On Android the
// capability is delivered entirely by PSP SDKs (Stripe Terminal, Adyen, Moov,
// Visa Acceptance, NMI), each of which is a certified PCI MPoC solution. An app
// cannot open NfcAdapter reader mode and read a payment card itself — the card
// networks do not permit it and the kernels required to do it are the
// certified part.
//
// So the shape here is the same as iOS: FurlPay owns everything
// PSP-INDEPENDENT (availability gating, attestation, the till, the UI, the
// ledger) and a TapToPayProvider conformance supplies the rest. Nothing in this
// repo implements it yet, and UnconfiguredTapToPayProvider fails closed.
//
// ALSO NOT TRUE, and worth stating because it is the usual misconception: two
// ordinary phones cannot tap each other to send money. One of them has to be
// running an approved merchant terminal. The customer side is just a card, a
// wallet, or a watch. Host Card Emulation (HCE) is the OTHER direction — it
// makes a phone BE a card, which is not what this is.
// ---------------------------------------------------------------------------

/**
 * Every reason Tap to Pay might not be usable, in terms a merchant can act on.
 *
 * Modelled explicitly rather than as a Boolean because the remedies are
 * entirely different: "update Android" is a settings trip, "this phone has no
 * NFC" is a purchase, and "not in your country" is neither.
 */
sealed interface TapToPayUnavailable {
    /** No NFC hardware at all. */
    data object NoNfc : TapToPayUnavailable

    /** NFC present but switched off — the one the merchant can fix fastest. */
    data object NfcDisabled : TapToPayUnavailable

    /**
     * Below Android 12. PSP SDKs require API 31+; the app's own minSdk is 26,
     * so this is a real runtime state and not a theoretical one.
     */
    data object OsTooOld : TapToPayUnavailable

    /**
     * Play Integrity says the device or the app cannot be trusted: rooted,
     * unlocked bootloader, sideloaded build, emulator. PCI MPoC requires this
     * check, and it is the one refusal that must never be overridable.
     */
    data class IntegrityFailed(val detail: String?) : TapToPayUnavailable

    /** Region gating. Determined by the PSP, never guessed locally. */
    data class RegionNotSupported(val region: String?) : TapToPayUnavailable

    /** No PSP implementation is compiled in. The state this repo is in today. */
    data object NoProvider : TapToPayUnavailable

    /** The merchant has not accepted the scheme terms on this device yet. */
    data object TermsNotAccepted : TapToPayUnavailable

    /** The PSP has not finished onboarding this merchant. */
    data class MerchantNotOnboarded(val reason: String?) : TapToPayUnavailable

    /**
     * Whether offering a retry button is honest. Telling someone to try again
     * on a phone with no NFC is cruelty, not helpfulness.
     */
    val isRecoverable: Boolean
        get() = when (this) {
            NoNfc, OsTooOld, is RegionNotSupported -> false
            // Integrity is deliberately RECOVERABLE-looking but the remedy is
            // outside the app: unroot, or reinstall from Play. Retrying without
            // changing anything will fail again, which is the honest outcome.
            is IntegrityFailed -> false
            NfcDisabled, NoProvider, TermsNotAccepted, is MerchantNotOnboarded -> true
        }
}

sealed interface TapToPayAvailability {
    data object Available : TapToPayAvailability
    data class Unavailable(val reason: TapToPayUnavailable) : TapToPayAvailability

    val isAvailable: Boolean get() = this is Available
}

/**
 * One amount to collect.
 *
 * [idempotencyKey] is generated once per charge and reused across retries of
 * THAT charge. A fresh key per attempt is how a flaky network turns one sale
 * into three.
 */
data class TapToPayCharge(
    val amount: BigDecimal,
    val currencyCode: String = "USD",
    val reference: String? = null,
    val idempotencyKey: String = UUID.randomUUID().toString(),
) {
    /**
     * Minor units, which is what every card network and PSP actually wants.
     * HALF_UP, the way a till rounds — not HALF_EVEN, which would surprise a
     * merchant reconciling a drawer.
     */
    val minorUnits: Long
        get() = amount.movePointRight(2).setScale(0, RoundingMode.HALF_UP).toLong()

    /**
     * Guards the two ends a terminal must never accept. The ceiling is a
     * deliberate policy limit, not a network one — a mistyped amount is far
     * more likely than a genuine six-figure tap.
     */
    val isValid: Boolean
        get() = amount > BigDecimal.ZERO && amount <= MAX_AMOUNT

    companion object {
        val MAX_AMOUNT: BigDecimal = BigDecimal("10000")
    }
}

data class TapToPayResult(
    val transactionId: String,
    val amount: BigDecimal,
    val currencyCode: String,
    /** "Visa ••••4242" — for the receipt, never for routing. */
    val cardDescription: String?,
    val completedAtEpochMs: Long,
)

sealed interface TapToPayFailure {
    data class Unavailable(val reason: TapToPayUnavailable) : TapToPayFailure
    data object InvalidAmount : TapToPayFailure

    /** The customer moved the card away, or removed it too early. */
    data class CardReadFailed(val detail: String?) : TapToPayFailure

    /** The issuer said no. Not our failure, and the copy must not imply it is. */
    data class Declined(val reason: String?) : TapToPayFailure

    data object Cancelled : TapToPayFailure
    data class Network(val detail: String?) : TapToPayFailure
    data class ProviderFailure(val detail: String) : TapToPayFailure
}

/**
 * What a Payment Service Provider must supply.
 *
 * Everything below the tap: the certified kernel, the scheme terms, the card
 * read and the authorisation. See the file header for why this cannot be
 * implemented without a PSP.
 */
interface TapToPayProvider {

    /**
     * The PSP's own view of whether this merchant can transact right now:
     * onboarding complete, region supported, terminal configuration loaded.
     */
    suspend fun availability(): TapToPayAvailability

    /** Presents the scheme terms. Accepted once per merchant, not per device. */
    suspend fun acceptTermsIfNeeded(): GuardianResult<Unit>

    /**
     * Collects one payment. Presents the PSP's tap UI and returns when the
     * customer's card, phone or watch has been read and authorised.
     */
    suspend fun collect(charge: TapToPayCharge): GuardianResult<TapToPayResult>
}

/**
 * The implementation in force today: there is no PSP, so nothing can be taken.
 *
 * Fails closed on purpose. A stub that returned a fake success would let a
 * merchant believe they had been paid, which is the single worst outcome
 * available in this feature.
 */
object UnconfiguredTapToPayProvider : TapToPayProvider {
    override suspend fun availability(): TapToPayAvailability =
        TapToPayAvailability.Unavailable(TapToPayUnavailable.NoProvider)

    override suspend fun acceptTermsIfNeeded(): GuardianResult<Unit> =
        GuardianResult.Err("No payment provider is configured.")

    override suspend fun collect(charge: TapToPayCharge): GuardianResult<TapToPayResult> =
        GuardianResult.Err("No payment provider is configured.")
}
