package com.furlpay.guardian.domain.ramp

/**
 * Buying crypto from the watch is a HAND-OFF, never a checkout on the wrist.
 *
 * The purchase is Coinbase's hosted checkout: card entry, identity checks and
 * its terms. None of that belongs on a 1.4-inch screen, and a watch has no
 * browser a user could trust with a card number. So the watch picks an amount
 * and asks the paired phone to open the FurlPay app's Buy screen with it
 * pre-filled (native-app/app/ramp.tsx, deep link `furlpay://ramp`). The phone
 * then runs its own device-owner prompt before anything is charged.
 *
 * There is no status to poll afterwards: FurlPay receives no completion event
 * from Coinbase. The USDC shows up in the wallet balance, which the phone
 * already syncs to the watch (SyncProtocol.DATA_WALLET).
 */
object RampHandoff {

    /** Preset amounts in USD. Small on purpose: a wrist tap is not the place for a large purchase. */
    val PRESETS_USD: List<Int> = listOf(25, 50, 100)

    /** Same bounds the server enforces (apps/web OnrampSessionSchema). */
    const val MIN_USD = 1
    const val MAX_USD = 50_000

    /** Deep link the phone resolves to the Buy screen. Null for an out-of-range amount. */
    fun deepLink(amountUsd: Int): String? =
        if (amountUsd in MIN_USD..MAX_USD) "furlpay://ramp?mode=buy&amount=$amountUsd" else null

    /** What the watch says after the phone accepted the hand-off. */
    const val HANDED_OFF = "Continue on your phone. Coinbase completes the purchase there."

    /** What the watch says when the phone could not be reached or has no FurlPay app. */
    const val NO_PHONE = "Couldn't reach your phone. Open FurlPay on your phone to buy crypto."
}
