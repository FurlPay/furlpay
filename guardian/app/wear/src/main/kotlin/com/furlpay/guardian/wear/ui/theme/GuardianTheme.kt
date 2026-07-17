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
    /** Mint emerald — the trading-terminal accent of the premium redesign. */
    val Primary = Color(0xFF5CE5A6)
    val OnPrimary = Color(0xFF04291B)
    /** Deep blue-teal surface the mockups float content on. */
    val PrimaryContainer = Color(0xFF0E2B28)
    val OnPrimaryContainer = Color(0xFFB9F2D8)
    val MoneyPositive = Color(0xFF7CF0BE) // gains
    val OnMoneyPositive = Color(0xFF05331F)
    val Warning = Color(0xFFFFC98A) // approaching budget, HIGH priority
    val OnWarning = Color(0xFF4A2800)
    val Error = Color(0xFFFF9E96) // CRITICAL, declined, frozen, losses
    val OnError = Color(0xFF5C0A05)
    val OnSurface = Color(0xFFE4EFE9) // cool off-white, eye comfort
    val OnSurfaceVariant = Color(0xFF9FB8AE)
    val Outline = Color(0xFF6E8B80)
    /** Chart fill gradient top — the accent at low alpha over black. */
    val ChartFill = Color(0x405CE5A6)

    /** ARGB ints for protolayout (tiles) — same tokens, different type. */
    const val PRIMARY_ARGB = 0xFF5CE5A6.toInt()
    const val MONEY_POSITIVE_ARGB = 0xFF7CF0BE.toInt()
    const val ERROR_ARGB = 0xFFFF9E96.toInt()
    const val ON_SURFACE_ARGB = 0xFFE4EFE9.toInt()
    const val ON_SURFACE_VARIANT_ARGB = 0xFF9FB8AE.toInt()
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
    // Cards/list rows sit on the deep-teal surface, not neutral grey.
    surfaceContainerLow = Color(0xFF0A1F1D),
    surfaceContainer = FurlPayColors.PrimaryContainer,
    surfaceContainerHigh = Color(0xFF14332F),
)

@Composable
fun GuardianTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = FurlPayColorScheme, content = content)
}
