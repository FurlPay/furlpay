package com.furlpay.guardian.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ModifiersBuilders

/**
 * Shared tile plumbing. Every tile deep-links into the screen it summarizes —
 * a Wallet tile that opens the home menu makes the user navigate twice, which
 * violates "one screen, one action". The route rides an intent extra that
 * WearMainActivity reads as its start destination.
 */
const val EXTRA_ROUTE = "guardian.route"

fun openRouteModifier(packageName: String, clickId: String, route: String): ModifiersBuilders.Modifiers =
    ModifiersBuilders.Modifiers.Builder()
        .setClickable(
            ModifiersBuilders.Clickable.Builder()
                .setId(clickId)
                .setOnClick(
                    ActionBuilders.LaunchAction.Builder()
                        .setAndroidActivity(
                            ActionBuilders.AndroidActivity.Builder()
                                .setPackageName(packageName)
                                .setClassName("com.furlpay.guardian.wear.WearMainActivity")
                                .addKeyToExtraMapping(
                                    EXTRA_ROUTE,
                                    ActionBuilders.AndroidStringExtra.Builder()
                                        .setValue(route)
                                        .build(),
                                )
                                .build(),
                        )
                        .build(),
                )
                .build(),
        )
        .build()
