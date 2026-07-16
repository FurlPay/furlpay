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
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.sync.TripsSnapshot
import com.furlpay.guardian.wear.Routes
import com.furlpay.guardian.wear.ui.theme.FurlPayColors
import com.furlpay.guardian.wear.wearServices
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future

/** Next trip + countdown ("Marriott Marquis · in 3d"). Snapshot cache only. */
class TravelTileService : TileService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> = scope.future {
        val next = applicationContext.wearServices.snapshots
            .read(SyncProtocol.DATA_TRIPS)
            ?.let { stored ->
                runCatching {
                    SyncProtocol.json.decodeFromString(TripsSnapshot.serializer(), stored.json)
                }.getOrNull()
            }
            ?.trips
            ?.filter { it.startAtMs >= System.currentTimeMillis() }
            ?.minByOrNull { it.startAtMs }

        val title = next?.title ?: "No trips"
        val caption = next?.let { trip ->
            val days = ((trip.startAtMs - System.currentTimeMillis()) / 86_400_000L).coerceAtLeast(0)
            val countdown = if (days == 0L) "today" else "in ${days}d"
            listOfNotNull(countdown, trip.detail).joinToString(" · ")
        } ?: "book from your phone"

        TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setFreshnessIntervalMillis(60L * 60 * 1000)
            .setTileTimeline(
                TimelineBuilders.Timeline.fromLayoutElement(
                    LayoutElementBuilders.Column.Builder()
                        .setModifiers(openRouteModifier(packageName, "open-travel", Routes.HOME))
                        .addContent(
                            Text.Builder(this@TravelTileService, title)
                                .setTypography(Typography.TYPOGRAPHY_TITLE3)
                                .setColor(argb(FurlPayColors.ON_SURFACE_ARGB))
                                .setMaxLines(2)
                                .build(),
                        )
                        .addContent(
                            Text.Builder(this@TravelTileService, caption)
                                .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                                .setColor(argb(FurlPayColors.PRIMARY_ARGB))
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
