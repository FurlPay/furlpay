package com.furlpay.guardian.domain

import com.furlpay.guardian.domain.upi.UpiPaymentRequest
import java.math.BigDecimal
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * These cases intentionally mirror `native-app/lib/__tests__/upi.test.ts`. The
 * RN app and Guardian scan the same QR codes, so a rule enforced in one parser
 * and not the other means the two apps disagree about what is payable.
 */
class UpiPaymentRequestTest {

    private val vpa = "merchant@ybl"

    // ── Well-formed ────────────────────────────────────────────────────────

    @Test
    fun `parses a dynamic merchant QR`() {
        val req = assertNotNull(
            UpiPaymentRequest.fromUri(
                "upi://pay?pa=$vpa&pn=Chai%20Point&am=42.50&cu=INR&tr=TXN123&tn=Order%20Payment&mc=5812"
            )
        )
        assertEquals(vpa, req.payeeVpa)
        assertEquals("Chai Point", req.payeeName)
        assertEquals(BigDecimal("42.50"), req.amount)
        assertEquals("INR", req.currency)
        assertEquals("TXN123", req.transactionRef)
        assertEquals("Order Payment", req.transactionNote)
        assertEquals("5812", req.merchantCode)
        assertTrue(req.hasFixedAmount)
    }

    @Test
    fun `parses a static QR with no amount`() {
        val req = assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&pn=Corner%20Shop"))
        assertNull(req.amount)
        assertFalse(req.hasFixedAmount)
    }

    @Test
    fun `accepts the spellings QR encoders actually emit`() {
        assertNotNull(UpiPaymentRequest.fromUri("UPI://PAY?pa=$vpa"))
        assertNotNull(UpiPaymentRequest.fromUri("upi:pay?pa=$vpa"))
        assertNotNull(UpiPaymentRequest.fromUri("  upi://pay?pa=$vpa  "))
    }

    @Test
    fun `accepts real-world handle shapes with digits and hyphens`() {
        assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=shop.1_x@okhdfcbank"))
        assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=a-b@paytm-1"))
    }

    // ── Rejected ───────────────────────────────────────────────────────────

    @Test
    fun `rejects non-UPI input`() {
        assertNull(UpiPaymentRequest.fromUri("0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e"))
        assertNull(UpiPaymentRequest.fromUri("https://furlpay.com/pay?to=x"))
        assertNull(UpiPaymentRequest.fromUri(""))
    }

    @Test
    fun `rejects a missing or malformed VPA`() {
        assertNull(UpiPaymentRequest.fromUri("upi://pay?pn=NoPayee&am=10"))
        assertNull(UpiPaymentRequest.fromUri("upi://pay?pa=nohandle"))
        assertNull(UpiPaymentRequest.fromUri("upi://pay?pa=@ybl"))
        assertNull(UpiPaymentRequest.fromUri("upi://pay?pa=a@1bank"))
    }

    @Test
    fun `rejects a non-INR currency`() {
        assertNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&am=10&cu=USD"))
    }

    /** A malformed amount is NOT a static QR — degrading would silently drop the
     *  charge the merchant intended and ask the user to invent one. */
    @Test
    fun `rejects a malformed amount instead of falling back to static`() {
        listOf("1,000", "1e6", "10.999", "-5", "0", "abc").forEach {
            assertNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&am=$it"), "am=$it should be rejected")
        }
    }

    @Test
    fun `rejects an absurd amount`() {
        assertNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&am=999999999"))
    }

    @Test
    fun `treats an empty am as a static QR`() {
        assertNull(assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&am=")).amount)
    }

    // ── Hostile content ────────────────────────────────────────────────────

    @Test
    fun `strips control characters from display text`() {
        val req = assertNotNull(
            UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&pn=Starbucks%0AAmount%3A%201&tn=note%0D%0AVerified")
        )
        assertFalse(req.payeeName!!.contains("\n"))
        assertFalse(req.transactionNote!!.contains("\r"))
        assertFalse(req.transactionNote!!.contains("\n"))
    }

    @Test
    fun `caps absurdly long display text`() {
        val req = assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&pn=" + "A".repeat(5000)))
        assertEquals(128, req.payeeName!!.length)
    }

    @Test
    fun `returns null rather than an empty name`() {
        assertNull(assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&pn=")).payeeName)
        assertNull(assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&pn=%20%20")).payeeName)
    }

    /** A QR repeating `pa=` must not be able to show one payee and pay another. */
    @Test
    fun `takes the first occurrence of a duplicated parameter`() {
        val req = assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&pa=attacker@evil"))
        assertEquals(vpa, req.payeeVpa)
    }

    // ── looksLikeUpi ───────────────────────────────────────────────────────

    @Test
    fun `distinguishes a damaged UPI QR from a non-UPI QR`() {
        assertTrue(UpiPaymentRequest.looksLikeUpi("upi://pay?pa=broken"))
        assertNull(UpiPaymentRequest.fromUri("upi://pay?pa=broken"))
        assertFalse(UpiPaymentRequest.looksLikeUpi("0xabc"))
    }

    // ── Rebuilding ─────────────────────────────────────────────────────────

    @Test
    fun `round-trips through toIntentUri`() {
        val original = assertNotNull(
            UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&pn=Chai%20Point&am=42.50&tr=TXN123")
        )
        assertEquals(original, UpiPaymentRequest.fromUri(original.toIntentUri()))
    }

    @Test
    fun `encodes spaces as percent-20 not plus`() {
        val req = assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&pn=Chai%20Point&am=1"))
        val uri = req.toIntentUri()
        assertTrue(uri.contains("pn=Chai%20Point"))
        assertFalse(uri.contains("+"))
    }

    @Test
    fun `applies an amount override for a static QR`() {
        val req = assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa"))
        assertTrue(req.toIntentUri(BigDecimal("250.00")).contains("am=250.00"))
    }

    /** BigDecimal.toString() can emit "1E+3", which no PSP app accepts. */
    @Test
    fun `never emits scientific notation for the amount`() {
        val req = assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa"))
        assertTrue(req.toIntentUri(BigDecimal("1000")).contains("am=1000"))
    }

    @Test
    fun `refuses to build a URI with no or invalid amount`() {
        val static = assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa"))
        assertFailsWith<IllegalArgumentException> { static.toIntentUri() }
        assertFailsWith<IllegalArgumentException> { static.toIntentUri(BigDecimal("-1")) }
        assertFailsWith<IllegalArgumentException> { static.toIntentUri(BigDecimal("999999999")) }
    }

    @Test
    fun `always emits INR`() {
        val req = assertNotNull(UpiPaymentRequest.fromUri("upi://pay?pa=$vpa&am=5"))
        assertTrue(req.toIntentUri().contains("cu=INR"))
    }
}
