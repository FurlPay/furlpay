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
import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.wear.wearServices
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future
import kotlinx.datetime.Clock

/** Life Guardian: the next thing that needs you, with a countdown. */
class NextEventTileService : TileService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> = scope.future {
        val now = Clock.System.now()
        val next = (applicationContext.wearServices.eventRepo.activeEvents() as? GuardianResult.Ok)
            ?.value
            ?.filter { it.startAt != null && it.startAt!! >= now }
            ?.minByOrNull { it.startAt!! }

        val (title, countdown) = if (next?.startAt != null) {
            val minutes = (next.startAt!! - now).inWholeMinutes.coerceAtLeast(0)
            next.title to when {
                minutes < 60 -> "in ${minutes}m"
                minutes < 24 * 60 -> "in ${minutes / 60}h ${minutes % 60}m"
                else -> "in ${minutes / (24 * 60)}d"
            }
        } else {
            "All clear" to "nothing scheduled"
        }

        TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setFreshnessIntervalMillis(15L * 60 * 1000)
            .setTileTimeline(
                TimelineBuilders.Timeline.fromLayoutElement(layout(title, countdown)),
            )
            .build()
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> = scope.future {
        ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build()
    }

    private fun layout(title: String, countdown: String): LayoutElementBuilders.LayoutElement =
        LayoutElementBuilders.Column.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("open-events")
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
                Text.Builder(this, title)
                    .setTypography(Typography.TYPOGRAPHY_TITLE3)
                    .setColor(argb(ON_SURFACE))
                    .setMaxLines(2)
                    .build(),
            )
            .addContent(
                Text.Builder(this, countdown)
                    .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                    .setColor(argb(PRIMARY))
                    .build(),
            )
            .build()

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    companion object {
        private const val RESOURCES_VERSION = "1"
        private const val PRIMARY = 0xFFA8C7FA.toInt()
        private const val ON_SURFACE = 0xFFE3E3E3.toInt()
    }
}
