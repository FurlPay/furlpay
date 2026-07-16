package com.furlpay.guardian.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

/**
 * FurlPay AMOLED-first palette (design bible §4). Pure black background is
 * non-negotiable — black pixels are OFF pixels on a watch OLED. One place for
 * the tokens so screens, tiles, and complications can never drift.
 */
object FurlPayColors {
    val Background = Color(0xFF000000)
    val Primary = Color(0xFFA8C7FA) // brand soft blue
    val OnPrimary = Color(0xFF062E6F)
    val PrimaryContainer = Color(0xFF1B4A8E)
    val OnPrimaryContainer = Color(0xFFD6E2FF)
    val MoneyPositive = Color(0xFFC3E8C0) // gains
    val OnMoneyPositive = Color(0xFF0A3818)
    val Warning = Color(0xFFFFB77C) // approaching budget, HIGH priority
    val OnWarning = Color(0xFF4A2800)
    val Error = Color(0xFFFFB4AB) // CRITICAL, declined, frozen
    val OnError = Color(0xFF690005)
    val OnSurface = Color(0xFFE3E3E3) // off-white, eye comfort
    val OnSurfaceVariant = Color(0xFFC4C7C5)
    val Outline = Color(0xFF8E9192)

    /** ARGB ints for protolayout (tiles) — same tokens, different type. */
    const val PRIMARY_ARGB = 0xFFA8C7FA.toInt()
    const val MONEY_POSITIVE_ARGB = 0xFFC3E8C0.toInt()
    const val ERROR_ARGB = 0xFFFFB4AB.toInt()
    const val ON_SURFACE_ARGB = 0xFFE3E3E3.toInt()
    const val ON_SURFACE_VARIANT_ARGB = 0xFFC4C7C5.toInt()
}

private val FurlPayColorScheme = ColorScheme(
    primary = FurlPayColors.Primary,
    onPrimary = FurlPayColors.OnPrimary,
    primaryContainer = FurlPayColors.PrimaryContainer,
    onPrimaryContainer = FurlPayColors.OnPrimaryContainer,
    secondary = FurlPayColors.MoneyPositive,
    onSecondary = FurlPayColors.OnMoneyPositive,
    tertiary = FurlPayColors.Warning,
    onTertiary = FurlPayColors.OnWarning,
    background = FurlPayColors.Background,
    onBackground = FurlPayColors.OnSurface,
    onSurface = FurlPayColors.OnSurface,
    onSurfaceVariant = FurlPayColors.OnSurfaceVariant,
    outline = FurlPayColors.Outline,
    error = FurlPayColors.Error,
    onError = FurlPayColors.OnError,
)

@Composable
fun GuardianTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = FurlPayColorScheme, content = content)
}
