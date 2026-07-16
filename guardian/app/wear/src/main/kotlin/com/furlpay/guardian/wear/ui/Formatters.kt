package com.furlpay.guardian.wear.ui

import java.util.Locale

/** "$1,234.56" — full form for screens. */
fun usd(n: Double): String = "$" + String.format(Locale.US, "%,.2f", n)

/** "$1.2k" / "$847" / "$3.4M" — compact form for tiles + complications. */
fun compactUsd(n: Double): String = when {
    n >= 1_000_000 -> "$" + String.format(Locale.US, "%.1f", n / 1_000_000) + "M"
    n >= 1_000 -> "$" + String.format(Locale.US, "%.1f", n / 1_000) + "k"
    else -> "$" + String.format(Locale.US, "%.0f", n)
}
