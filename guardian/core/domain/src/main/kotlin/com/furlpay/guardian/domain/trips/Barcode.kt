package com.furlpay.guardian.domain.trips

/**
 * Bar widths for the boarding-pass barcode.
 *
 * The SAME algorithm as apps/web/src/lib/trips/barcode.ts,
 * native-app/lib/barcode.ts and ios/FurlPayGuardian/Shared/UI/TripsViews.swift
 * — deliberately duplicated across the four codebases (there is no shared
 * runtime) and pinned by a test in each, so a passenger's pass draws
 * identically wherever they open it.
 *
 * Deterministic on purpose. A randomised pattern would differ between renders,
 * so the "randomness" is an FNV-1a hash of the value driving an LCG, which
 * gives the same bars for the same booking on every runtime, forever.
 *
 * THIS ENCODES NOTHING. It is a visual stand-in with a real barcode's rhythm:
 * guard bars at each end, narrow/wide alternation between them. It is not
 * scannable and must never be presented as though it were — the gate screen
 * shows the flight number and booking id in text alongside it for that reason.
 * Replace it with the carrier's actual PDF417 when Duffel returns one.
 */

private val LEADING_GUARD = intArrayOf(3, 2, 1, 3)
private val TRAILING_GUARD = intArrayOf(3, 2, 1, 4)
private const val BODY_BARS = 108
private const val MAX_BAR_WIDTH = 4

private const val FNV_OFFSET_BASIS = -0x7EE3623B // 0x811c9dc5 as a signed Int
private const val FNV_PRIME = 0x01000193
private const val LCG_MULTIPLIER = 1_664_525
private const val LCG_INCREMENT = 1_013_904_223
private const val UINT32_RANGE = 4_294_967_296.0

/**
 * Widths alternate bar, gap, bar, gap... starting with a bar, exactly as the
 * other three implementations render them.
 *
 * Kotlin's `Int` multiply already wraps at 32 bits, which is what JavaScript's
 * `Math.imul` was doing on the other side; the mask back to unsigned happens
 * only where the value is divided into the 0-1 range.
 */
fun boardingPassBars(value: String): List<Int> {
    var seed = FNV_OFFSET_BASIS
    // Char.code is the UTF-16 code unit, matching the TypeScript original's
    // charCodeAt. Pass ids are ASCII, where this also agrees with the Swift
    // port's UTF-8 bytes.
    for (char in value) {
        seed = seed xor char.code
        seed *= FNV_PRIME
    }

    val bars = ArrayList<Int>(LEADING_GUARD.size + BODY_BARS + TRAILING_GUARD.size)
    LEADING_GUARD.forEach { bars.add(it) }
    repeat(BODY_BARS) {
        seed = seed * LCG_MULTIPLIER + LCG_INCREMENT
        val unitInterval = (seed.toLong() and 0xFFFF_FFFFL).toDouble() / UINT32_RANGE
        bars.add(1 + (unitInterval * MAX_BAR_WIDTH).toInt())
    }
    TRAILING_GUARD.forEach { bars.add(it) }
    return bars
}
