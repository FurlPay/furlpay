package com.furlpay.guardian.wear.tile

import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.furlpay.guardian.sync.MarketSnapshot
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.wear.Routes
import com.furlpay.guardian.wear.ui.compactUsd
import com.furlpay.guardian.wear.ui.signedPct
import com.furlpay.guardian.wear.ui.theme.FurlPayColors
import com.furlpay.guardian.wear.wearServices
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future

/** "BTC $68,421 ▼2.1%" — headline crypto quote from the market snapshot. */
class MarketTileService : TileService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> = scope.future {
        val snapshot = applicationContext.wearServices.snapshots
            .read(SyncProtocol.DATA_MARKET)
            ?.let { stored ->
                runCatching {
                    SyncProtocol.json.decodeFromString(MarketSnapshot.serializer(), stored.json)
                }.getOrNull()
            }

        val lead = snapshot?.items?.firstOrNull()
        val headline = lead?.let { "${it.symbol} ${compactUsd(it.price)}" } ?: "—"
        val caption = lead?.let { item ->
            val rest = snapshot.items.drop(1).joinToString(" · ") { it.symbol + " " + signedPct(it.changePct) }
            signedPct(item.changePct) + if (rest.isNotEmpty()) " · $rest" else ""
        } ?: "Markets"
        val headlineColor = when {
            lead == null -> FurlPayColors.ON_SURFACE_VARIANT_ARGB
            lead.changePct >= 0 -> FurlPayColors.MONEY_POSITIVE_ARGB
            else -> FurlPayColors.ERROR_ARGB
        }

        TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setFreshnessIntervalMillis(15L * 60 * 1000)
            .setTileTimeline(
                TimelineBuilders.Timeline.fromLayoutElement(
                    LayoutElementBuilders.Column.Builder()
                        .setModifiers(openRouteModifier(packageName, "open-market", Routes.PORTFOLIO))
                        .addContent(
                            Text.Builder(this@MarketTileService, headline)
                                .setTypography(Typography.TYPOGRAPHY_TITLE2)
                                .setColor(argb(headlineColor))
                                .build(),
                        )
                        .addContent(
                            Text.Builder(this@MarketTileService, caption)
                                .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                                .setColor(argb(FurlPayColors.ON_SURFACE_VARIANT_ARGB))
                                .setMaxLines(2)
                                .build(),
                        )
                        .build(),
                ),
            )
            .build()
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> = scope.future {
        ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build()
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    companion object {
        private const val RESOURCES_VERSION = "1"
    }
}
