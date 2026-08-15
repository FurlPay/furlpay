package com.furlpay.guardian.domain.upi

import java.math.BigDecimal
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * A scanned UPI deep link (NPCI UPI Linking Specification), `upi://pay?pa=…`.
 *
 * WHY THIS IS PARSED BY HAND. The obvious implementation uses `android.net.Uri`,
 * but this module is pure JVM by design (see build.gradle.kts) so the logic is
 * unit-testable without an emulator — and `Uri` is not on the classpath here.
 * The grammar is small and fully specified, so parsing it directly costs less
 * than the dependency would.
 *
 * THIS MIRRORS `native-app/lib/upi.ts` DELIBERATELY. The RN app and Guardian
 * scan the same QR codes, so a rule enforced in one and not the other means the
 * two apps disagree about whether a given merchant QR is payable. Every
 * decision below — INR-only, strict amount grammar, control-character
 * stripping, malformed-amount rejection — is matched there, and the test suites
 * assert the same cases.
 *
 * SECURITY. [payeeVpa] is the ONLY field that decides where money goes.
 * [payeeName] is attacker-controlled text lifted straight out of the QR: a code
 * taped over a merchant's real one can claim any name. UI MUST show the VPA
 * with equal weight and must never present the name alone as the payee's
 * identity. [amount] is likewise attacker-supplied, so it is bounded here and
 * shown prominently before the user confirms.
 *
 * Guardian's security model treats paying as MUTATING: launching a UPI app from
 * a scanned code is a phone-side action behind BiometricGate, and the watch must
 * refuse it (the watch cannot show the VPA legibly enough to check it).
 */
data class UpiPaymentRequest(
    /** Payee VPA, e.g. `merchant@ybl`. The only field that routes money. */
    val payeeVpa: String,
    /** Display name from the QR — UNVERIFIED. Show next to the VPA, never alone. */
    val payeeName: String?,
    /** Amount in INR, or null for a static QR where the user supplies one. */
    val amount: BigDecimal?,
    /** Merchant transaction reference. */
    val transactionRef: String?,
    /** Free-text note. */
    val transactionNote: String?,
    /** ISO 18245 merchant category code, when present. */
    val merchantCode: String?,
) {
    /** UPI settles in rupees only; there is no other possible value. */
    val currency: String get() = "INR"

    /** True when the QR fixed an amount (dynamic QR) rather than leaving it open. */
    val hasFixedAmount: Boolean get() = amount != null

    /**
     * Rebuild a canonical `upi://pay?…` URI to hand to a PSP app.
     *
     * [amountOverride] supplies the amount for a static QR. It is validated
     * rather than trusted, so a UI defect cannot hand a payment app a malformed
     * figure.
     *
     * @throws IllegalArgumentException if no amount is available or it is invalid.
     */
    fun toIntentUri(amountOverride: BigDecimal? = null): String {
        val effective = amountOverride ?: amount
        require(effective != null) { "UPI payment needs an amount" }
        require(isPayableAmount(effective)) { "Invalid UPI amount: $effective" }

        val parts = mutableListOf(
            "pa=${encode(payeeVpa)}",
            "cu=INR",
            // Always plain-string the amount: BigDecimal.toString() can emit
            // scientific notation ("1E+3"), which no PSP app accepts.
            "am=${effective.toPlainString()}",
        )
        payeeName?.let { parts += "pn=${encode(it)}" }
        transactionRef?.let { parts += "tr=${encode(it)}" }
        transactionNote?.let { parts += "tn=${encode(it)}" }
        merchantCode?.let { parts += "mc=${encode(it)}" }
        return "upi://pay?" + parts.joinToString("&")
    }

    companion object {
        /**
         * Deliberately a shade more permissive than "handle is pure alpha":
         * real handles carry digits and hyphens (`@okhdfcbank`, `@paytm-1`), and
         * wrongly rejecting a valid merchant VPA means the user simply cannot
         * pay. The PSP app resolves and re-validates it, so this is a sanity
         * filter, never an authorisation decision.
         */
        private val VPA = Regex("^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$")

        /** Digits with at most two decimals. No exponents, no thousands separators. */
        private val AMOUNT = Regex("^\\d{1,9}(\\.\\d{1,2})?$")

        private val UPI_URI = Regex("^upi:(//)?pay\\?(.*)$", RegexOption.IGNORE_CASE)

        /** C0 controls, DEL, and C1 — newlines included, so a crafted note cannot
         *  forge an extra line in a confirmation screen. */
        private val CONTROL_CHARS = Regex("[\\u0000-\\u001F\\u007F-\\u009F]")

        /**
         * Upper sanity bound on a scanned amount. The PSP app enforces the real
         * per-transaction cap (it varies by bank and category); this only keeps
         * a nonsense figure from reaching a confirmation screen.
         */
        val MAX_AMOUNT: BigDecimal = BigDecimal(1_000_000)

        /** True when the string addresses the UPI scheme, parseable or not — lets
         *  a scanner say "that UPI QR is damaged" rather than "not payable". */
        fun looksLikeUpi(data: String): Boolean = UPI_URI.matches(data.trim())

        fun isPayableAmount(value: BigDecimal): Boolean =
            value > BigDecimal.ZERO && value <= MAX_AMOUNT && value.scale() <= 2

        /** Parse a scanned UPI URI, or null when it is not one / is malformed. */
        fun fromUri(data: String): UpiPaymentRequest? {
            val query = UPI_URI.find(data.trim())?.groupValues?.get(2) ?: return null
            val params = parseQuery(query)

            val vpa = params["pa"]?.trim()
            if (vpa.isNullOrEmpty() || !VPA.matches(vpa)) return null

            // A QR claiming a non-INR currency is malformed or hostile; honouring
            // it would render a figure these rails cannot pay.
            params["cu"]?.trim()?.uppercase()?.let { if (it != "INR") return null }

            // A static QR omits `am`. An `am` that is present but unparseable is
            // a MALFORMED QR, not a static one — treating it as static would
            // silently drop the charge the merchant intended.
            var amount: BigDecimal? = null
            val rawAmount = params["am"]?.trim()
            if (!rawAmount.isNullOrEmpty()) {
                if (!AMOUNT.matches(rawAmount)) return null
                val parsed = rawAmount.toBigDecimalOrNull() ?: return null
                if (!isPayableAmount(parsed)) return null
                amount = parsed
            }

            return UpiPaymentRequest(
                payeeVpa = vpa,
                payeeName = clean(params["pn"], 128),
                amount = amount,
                transactionRef = clean(params["tr"], 64),
                transactionNote = clean(params["tn"], 128),
                merchantCode = clean(params["mc"], 8),
            )
        }

        /** Later duplicates lose: a QR repeating `pa=` must not be able to show
         *  one payee and pay another. */
        private fun parseQuery(query: String): Map<String, String> =
            query.split("&")
                .mapNotNull { pair ->
                    if (pair.isEmpty()) return@mapNotNull null
                    val i = pair.indexOf('=')
                    if (i <= 0) return@mapNotNull null
                    decode(pair.substring(0, i)) to decode(pair.substring(i + 1))
                }
                .reversed()
                .toMap()

        private fun decode(value: String): String =
            runCatching { URLDecoder.decode(value, StandardCharsets.UTF_8) }.getOrDefault(value)

        private fun encode(value: String): String =
            // URLEncoder emits "+" for spaces, which several PSP apps pass
            // through literally into the note. Percent-encode instead.
            java.net.URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")

        private fun clean(value: String?, maxLength: Int): String? {
            val stripped = value?.replace(CONTROL_CHARS, "")?.trim().orEmpty()
            return if (stripped.isEmpty()) null else stripped.take(maxLength)
        }
    }
}
