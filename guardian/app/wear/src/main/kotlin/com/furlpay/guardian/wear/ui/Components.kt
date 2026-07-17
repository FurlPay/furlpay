package com.furlpay.guardian.wear.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseInOutCubic
import androidx.compose.animation.core.EaseOutCubic
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme

/**
 * Card-look surface WITHOUT click semantics. Wear M3 [Card] always announces
 * as an actionable button to TalkBack; for pure-display rows (a wallet
 * balance, a booked trip) that's an a11y lie — the row does nothing. This
 * renders the same deep-teal face with none of the button semantics.
 */
@Composable
fun InfoCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(
                MaterialTheme.colorScheme.surfaceContainer,
                MaterialTheme.shapes.large,
            )
            .padding(horizontal = 14.dp, vertical = 10.dp),
        content = content,
    )
}

/**
 * Breathing placeholder pill for a not-yet-loaded amount — same rhythm as the
 * voice screen's listening ring (bible §3: breathe, never strobe). Replaces
 * the bare "…" so loading reads as "coming" instead of "broken".
 */
@Composable
fun SkeletonAmount(
    modifier: Modifier = Modifier,
    width: Dp = 96.dp,
    height: Dp = 30.dp,
) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.7f,
        animationSpec = infiniteRepeatable(
            animation = tween(700, easing = EaseInOutCubic),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "skeleton-alpha",
    )
    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Box(
            modifier = Modifier
                .size(width, height)
                .graphicsLayer { this.alpha = alpha }
                .background(
                    MaterialTheme.colorScheme.surfaceContainerHigh,
                    RoundedCornerShape(percent = 50),
                ),
        )
    }
}

/**
 * Count-up for money headlines: 0 → value on first load, short glide on
 * refresh deltas. Returns the EXACT target once settled — Float precision is
 * only ever visible mid-flight, never in the resting number.
 */
@Composable
fun animatedUsd(target: Double): Double {
    val anim = remember { Animatable(0f) }
    LaunchedEffect(target) {
        anim.animateTo(target.toFloat(), tween(durationMillis = 600, easing = EaseOutCubic))
    }
    return if (anim.value == target.toFloat()) target else anim.value.toDouble()
}
