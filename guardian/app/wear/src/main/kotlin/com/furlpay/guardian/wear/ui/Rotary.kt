package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.wear.compose.foundation.requestFocusOnHierarchyActive
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable

/**
 * Rotary crown scrolling for a scrollable surface.
 *
 * Wear Compose does NOT wire the crown up for you. A `TransformingLazyColumn`
 * responds to touch and to nothing else until something attaches
 * [rotaryScrollable] and gives it a focus requester — and nothing in this
 * module did, so turning the crown on a Pixel Watch or a Galaxy Watch moved
 * nothing on any screen. On a device where the crown is the primary way through
 * a list, that is the whole navigation model missing, and it fails Google
 * Play's Wear OS quality bar, where rotary input is a listed requirement rather
 * than a nicety.
 *
 * [requestFocusOnHierarchyActive] hands focus to whichever
 * `SwipeDismissableNavHost` destination is on screen, so the crown drives the
 * screen the user is looking at and not one still on the back stack. It sits
 * BEFORE `rotaryScrollable` in the chain for the same reason
 * `Modifier.focusRequester` precedes `Modifier.focusTarget`: the requester has
 * to wrap the target it is requesting focus for, and `rotaryScrollable` is what
 * installs that target.
 *
 * Use it as the first modifier on the scrollable:
 *
 * ```
 * TransformingLazyColumn(
 *     modifier = Modifier.rotaryScroll(columnState),
 *     state = columnState,
 * )
 * ```
 */
@Composable
fun Modifier.rotaryScroll(scrollableState: ScrollableState): Modifier {
    val focusRequester = remember { FocusRequester() }
    return this
        .requestFocusOnHierarchyActive()
        .rotaryScrollable(
            // The default behaviour brings the crown detent haptics with it.
            // Wear users read those as position feedback, so a silent crown
            // feels broken even while the list is moving.
            behavior = RotaryScrollableDefaults.behavior(scrollableState),
            focusRequester = focusRequester,
        )
}
