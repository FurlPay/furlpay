package com.furlpay.guardian.wear.tile

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.furlpay.guardian.sync.PortfolioSnapshot
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.wear.ui.signedPct
import com.furlpay.guardian.wear.ui.signedUsd
import com.furlpay.guardian.wear.ui.theme.FurlPayColors
import com.furlpay.guardian.wear.wearServices
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future

/**
 * "+$42.30 today ▲" — the day-change headline, green for gains / red for
 * losses (money-semantic palette). Snapshot cache only, never blocks.
 */
class PortfolioTileService : TileService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> = scope.future {
        val snapshot = applicationContext.wearServices.snapshots
            .read(SyncProtocol.DATA_PORTFOLIO)
            ?.let { stored ->
                runCatching {
                    SyncProtocol.json.decodeFromString(PortfolioSnapshot.serializer(), stored.json)
                }.getOrNull()
            }

        val headline = snapshot?.let { signedUsd(it.dayChangeUsd) } ?: "—"
        val headlineColor = when {
            snapshot == null -> FurlPayColors.ON_SURFACE_VARIANT_ARGB
            snapshot.dayChangeUsd >= 0 -> FurlPayColors.MONEY_POSITIVE_ARGB
            else -> FurlPayColors.ERROR_ARGB
        }
        val caption = snapshot?.topMoverSymbol?.let { symbol ->
            "$symbol ${signedPct(snapshot.topMoverPct ?: 0.0)}"
        } ?: "Portfolio"

        TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setFreshnessIntervalMillis(30L * 60 * 1000)
            .setTileTimeline(
                TimelineBuilders.Timeline.fromLayoutElement(layout(caption, headline, headlineColor)),
            )
            .build()
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> = scope.future {
        ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build()
    }

    private fun layout(
        caption: String,
        headline: String,
        headlineColor: Int,
    ): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Column.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("open-portfolio")
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
                    .build(),
            )
            .addContent(
                Text.Builder(this, caption)
                    .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                    .setColor(argb(FurlPayColors.ON_SURFACE_VARIANT_ARGB))
                    .build(),
            )
            .addContent(
                Text.Builder(this, headline)
                    .setTypography(Typography.TYPOGRAPHY_DISPLAY3)
                    .setColor(argb(headlineColor))
                    .build(),
            )
            .build()

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    companion object {
        private const val RESOURCES_VERSION = "1"
    }
}
