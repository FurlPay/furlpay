package com.furlpay.guardian.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.sync.WalletSnapshot
import com.furlpay.guardian.wear.ui.compactUsd
import com.furlpay.guardian.wear.ui.theme.FurlPayColors
import com.furlpay.guardian.wear.wearServices
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future

/**
 * "How much do I have?" — one number on black, tap opens the app. Reads the
 * snapshot cache only: tiles must render instantly and never block on network.
 * (The listener service + home screen keep the cache fresh and poke updates.)
 */
class WalletTileService : TileService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> = scope.future {
        val snapshot = applicationContext.wearServices.snapshots
            .read(SyncProtocol.DATA_WALLET)
            ?.let { stored ->
                runCatching {
                    SyncProtocol.json.decodeFromString(WalletSnapshot.serializer(), stored.json)
                }.getOrNull()
            }

        val headline = snapshot?.let { compactUsd(it.totalUsd) } ?: "—"
        val caption = if (snapshot != null) "FurlPay" else "Open app to sync"

        TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setFreshnessIntervalMillis(30L * 60 * 1000)
            .setTileTimeline(
                TimelineBuilders.Timeline.fromLayoutElement(tileLayout(caption, headline)),
            )
            .build()
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> = scope.future {
        ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build()
    }

    private fun tileLayout(caption: String, headline: String): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Column.Builder()
            .setModifiers(openAppModifier())
            .addContent(
                Text.Builder(this, caption)
                    .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                    .setColor(argb(CAPTION_COLOR))
                    .build(),
            )
            .addContent(
                Text.Builder(this, headline)
                    .setTypography(Typography.TYPOGRAPHY_DISPLAY1)
                    .setColor(argb(PRIMARY_COLOR))
                    .build(),
            )
            .build()

    private fun openAppModifier() = ModifiersBuilders.Modifiers.Builder()
        .setClickable(
            ModifiersBuilders.Clickable.Builder()
                .setId("open-wallet")
                .setOnClick(
                    ActionBuilders.LaunchAction.Builder()
                        .setAndroidActivity(
                            ActionBuilders.AndroidActivity.Builder()
                                .setPackageName(packageName)
                                .setClassName("com.furlpay.guardian.wear.WearMainActivity")
                                .build(),
                        )
                        .build(),
                )
                .build(),
        )
        .build()

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    companion object {
        private const val RESOURCES_VERSION = "1"
        private const val PRIMARY_COLOR = FurlPayColors.PRIMARY_ARGB
        private const val CAPTION_COLOR = FurlPayColors.ON_SURFACE_VARIANT_ARGB
    }
}
