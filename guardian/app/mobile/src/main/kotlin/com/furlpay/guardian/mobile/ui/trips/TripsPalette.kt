package com.furlpay.guardian.mobile.ui.trips

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Trips surface tokens.
 *
 * These are the SAME colours as TripsPalette in
 * ios/FurlPayGuardian/Shared/UI/FurlPayMark.swift, converted from its 0-1
 * components. A passenger who opens the pass on a phone and a watch — or who
 * screenshots it from one platform and shows it on another — should be looking
 * at the same document, so the values are ported rather than re-eyeballed.
 *
 * Deliberately NOT wired into the app's MaterialTheme colour scheme. The pass
 * is a fixed-appearance document: it is LIGHT on a dark app on purpose (see
 * [TripsScreen]), so letting a theme recolour it would be a bug, not a feature.
 */
object TripsPalette {

    // Live flight card — near-black emerald, as on the Lock Screen.
    val liveTop = Color(0xFF06170F)
    val liveBottom = Color(0xFF020A07)

    // Trip hero header.
    val heroTop = Color(0xFF1D7150)
    val heroBottom = Color(0xFF1E7A58)

    // Accent as it reads on a DARK surface.
    val green = Color(0xFF5FDCA0)
    val greenBright = Color(0xFF8DF0BC)
    val greenDim = Color(0xFF4ADE96)

    /**
     * Accent on the LIGHT pass. Never use [green] there — it fails contrast on
     * white by a wide margin.
     */
    val ink = Color(0xFF1B7A4E)

    val passInk = Color(0xFF111113)
    val passInkDim = Color(0xFF6E6E73)
    val passChip = Color(0xFFE8E8EA)
    val passRule = Color(0xFFDCDCDE)
    val passInset = Color(0xFFF4F4F6)

    val subText = Color(0xFFB6C4BE)
    val background = Color(0xFF05050A)
    val surface = Color(0xFF14141F)

    /** Bars are drawn at near-black rather than pure black: a gate scanner
     *  wants contrast, and OLED pure black can bloom under a reader. */
    val barcodeInk = Color(0xFF0A0A0A)

    val glyphGrey = Color(0xFF3C3C43)
    val chipGrey = Color(0xFFEBEBED)
    val trackBg = Color(0xFF111715)

    val arcDash = Color(0xFF3FCB88)
    val bead = Color(0xFFC8FBDE)
    val arcPlane = Color(0xFF5FE3A0)

    val cardBorder = Color(0x4378D6A8)
    val tile = Color(0x0DFFFFFF)
    val tileBorder = Color(0x14FFFFFF)
}

/** Corner radii, matched to the SwiftUI continuous-corner values. */
object TripsRadius {
    val live = 26.dp
    val hero = 26.dp
    val pass = 22.dp
    val card = 20.dp
    val inset = 14.dp
}
