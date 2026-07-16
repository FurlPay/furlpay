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
import com.furlpay.guardian.wear.Routes
import com.furlpay.guardian.wear.ui.theme.FurlPayColors
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future

/** One-tap "show my receive QR" — the QR itself renders in QuickPayScreen. */
class QuickPayTileService : TileService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> = scope.future {
        TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setTileTimeline(
                TimelineBuilders.Timeline.fromLayoutElement(
                    LayoutElementBuilders.Column.Builder()
                        .setModifiers(openRouteModifier(packageName, "open-quickpay", Routes.QUICKPAY))
                        .addContent(
                            Text.Builder(this@QuickPayTileService, "⚡")
                                .setTypography(Typography.TYPOGRAPHY_DISPLAY1)
                                .setColor(argb(FurlPayColors.PRIMARY_ARGB))
                                .build(),
                        )
                        .addContent(
                            Text.Builder(this@QuickPayTileService, "Receive")
                                .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                                .setColor(argb(FurlPayColors.ON_SURFACE_VARIANT_ARGB))
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
