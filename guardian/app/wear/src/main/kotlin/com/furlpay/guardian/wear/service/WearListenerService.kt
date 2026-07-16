package com.furlpay.guardian.wear.service

import android.content.ComponentName
import androidx.core.content.ContextCompat
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.furlpay.guardian.sync.AlarmSignal
import com.furlpay.guardian.sync.SyncProtocol
import com.furlpay.guardian.wear.complication.BalanceComplicationService
import com.furlpay.guardian.wear.complication.DailySpendComplicationService
import com.furlpay.guardian.wear.complication.PortfolioChangeComplicationService
import com.furlpay.guardian.wear.tile.MarketTileService
import com.furlpay.guardian.wear.tile.PortfolioTileService
import com.furlpay.guardian.wear.tile.WalletTileService
import com.furlpay.guardian.wear.wearServices
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.runBlocking

/**
 * The watch's Data Layer inbox — runs even when the app doesn't. Session
 * token goes STRAIGHT into the Keystore-encrypted store; snapshots land in
 * the Room cache and poke the tile/complication renderers.
 */
class WearListenerService : WearableListenerService() {

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        val services = applicationContext.wearServices
        for (event in dataEvents) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val path = event.dataItem.uri.path ?: continue
            val json = DataMapItem.fromDataItem(event.dataItem)
                .dataMap.getString(SyncProtocol.KEY_JSON) ?: continue

            // WearableListenerService callbacks run on a background thread;
            // blocking briefly here is the documented pattern.
            runBlocking {
                when (path) {
                    SyncProtocol.DATA_AUTH_TOKEN -> {
                        services.tokenStore.update(json.takeIf { it.isNotBlank() })
                    }

                    SyncProtocol.DATA_WALLET -> {
                        services.snapshots.write(path, json)
                        TileService.getUpdater(applicationContext)
                            .requestUpdate(WalletTileService::class.java)
                        requestComplicationUpdate(BalanceComplicationService::class.java)
                    }

                    SyncProtocol.DATA_PORTFOLIO -> {
                        services.snapshots.write(path, json)
                        TileService.getUpdater(applicationContext)
                            .requestUpdate(PortfolioTileService::class.java)
                        requestComplicationUpdate(PortfolioChangeComplicationService::class.java)
                    }

                    SyncProtocol.DATA_SPENDING -> {
                        services.snapshots.write(path, json)
                        requestComplicationUpdate(DailySpendComplicationService::class.java)
                    }

                    SyncProtocol.DATA_MARKET -> {
                        services.snapshots.write(path, json)
                        TileService.getUpdater(applicationContext)
                            .requestUpdate(MarketTileService::class.java)
                    }

                    SyncProtocol.DATA_EVENTS, SyncProtocol.DATA_TRIPS -> {
                        services.snapshots.write(path, json)
                    }
                    // DATA_VOICE_RESPONSE is consumed live by VoiceViewModel.
                }
            }
        }
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        when (messageEvent.path) {
            // Phone's alarm rung fired — buzz the wrist with the same ladder.
            SyncProtocol.MSG_ALARM -> {
                val signal = runCatching {
                    SyncProtocol.json.decodeFromString(
                        AlarmSignal.serializer(),
                        messageEvent.data.decodeToString(),
                    )
                }.getOrNull() ?: return
                ContextCompat.startForegroundService(
                    applicationContext,
                    WatchAlarmService.ringIntent(applicationContext, signal),
                )
            }

            // Phone was acknowledged — silence the wrist without echoing back.
            SyncProtocol.MSG_ALARM_ACK -> {
                startService(
                    android.content.Intent(this, WatchAlarmService::class.java)
                        .setAction(WatchAlarmService.ACTION_SILENCE),
                )
            }
        }
    }

    private fun requestComplicationUpdate(service: Class<*>) {
        ComplicationDataSourceUpdateRequester
            .create(applicationContext, ComponentName(applicationContext, service))
            .requestUpdateAll()
    }
}
