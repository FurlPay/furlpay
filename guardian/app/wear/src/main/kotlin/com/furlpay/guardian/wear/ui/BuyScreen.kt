package com.furlpay.guardian.wear.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.furlpay.guardian.domain.ramp.RampHandoff

/**
 * Buy USDC — picks an amount and hands off to the phone. See
 * [RampHandoff] for why the watch never opens a checkout itself and why there
 * is no status to poll afterwards.
 */
@Composable
fun BuyScreen() {
    val context = LocalContext.current
    val haptics = rememberHaptics()
    var message by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    fun handOff(amountUsd: Int) {
        val link = RampHandoff.deepLink(amountUsd) ?: return
        sending = true
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).addCategory(Intent.CATEGORY_BROWSABLE)
        val future = RemoteActivityHelper(context).startRemoteActivity(intent)
        future.addListener(
            {
                sending = false
                message = try {
                    future.get()
                    haptics.click()
                    RampHandoff.HANDED_OFF
                } catch (_: Exception) {
                    RampHandoff.NO_PHONE
                }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    ScreenScaffold {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
        ) {
            Text("Buy USDC", style = MaterialTheme.typography.titleMedium)
            val shown = message
            if (shown != null) {
                Text(shown, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
            } else {
                RampHandoff.PRESETS_USD.forEach { amount ->
                    Button(
                        onClick = { handOff(amount) },
                        enabled = !sending,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("$$amount on phone") }
                }
                Text(
                    "Paid with Coinbase on your phone",
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
