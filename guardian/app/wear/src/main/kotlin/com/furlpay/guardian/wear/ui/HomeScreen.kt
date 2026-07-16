package com.furlpay.guardian.wear.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.wear.Routes
import com.furlpay.guardian.wear.viewmodel.HomeViewModel

/**
 * The 5-second glance: total balance headline, what's next, three actions.
 * One screen, one job — never a shrunken phone dashboard.
 */
@Composable
fun HomeScreen(
    navController: NavController,
    viewModel: HomeViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val columnState = rememberTransformingLazyColumnState()

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(
            state = columnState,
            contentPadding = contentPadding,
        ) {
            item {
                Text(
                    text = when {
                        state.loading -> "…"
                        state.signedOut -> "Open FurlPay on your phone to sync"
                        state.totalUsd != null -> usd(state.totalUsd!!)
                        else -> "No data yet"
                    },
                    style = MaterialTheme.typography.displaySmall,
                    color = MaterialTheme.colorScheme.primary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (state.stale) {
                item {
                    Text(
                        text = "offline · cached",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            state.nextEventTitle?.let { title ->
                item {
                    Text(
                        text = "Next: $title",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            state.nextTripTitle?.let { title ->
                item {
                    Text(
                        text = "Trip: $title",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            item {
                Button(
                    onClick = { navController.navigate(Routes.WALLET) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Wallet") }
            }
            item {
                Button(
                    onClick = { navController.navigate(Routes.CARDS) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Cards") }
            }
            item {
                Button(
                    onClick = { navController.navigate(Routes.VOICE) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Ask Guardian") }
            }
        }
    }
}
