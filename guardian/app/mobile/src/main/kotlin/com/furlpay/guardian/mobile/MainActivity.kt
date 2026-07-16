package com.furlpay.guardian.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.furlpay.guardian.mobile.viewmodel.DashboardViewModel
import com.furlpay.guardian.mobile.viewmodel.SignInViewModel
import com.furlpay.guardian.security.AuthManager

/**
 * Phone shell: OTP sign-in → dashboard (balances, cards, trips) → watch sync.
 * The heavier Life Guardian surfaces (alarm ladder UI, briefing, Live voice)
 * layer on top of this skeleton next.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                GuardianRoot()
            }
        }
    }
}

@Composable
private fun GuardianRoot() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val authState by context.mobileServices.authManager.state.collectAsStateWithLifecycle()

    Scaffold { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (authState) {
                AuthManager.AuthState.Loading -> CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center),
                )
                AuthManager.AuthState.SignedOut -> SignInScreen()
                AuthManager.AuthState.SignedIn -> DashboardScreen()
            }
        }
    }
}

@Composable
private fun SignInScreen(viewModel: SignInViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Text("FurlPay Guardian", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Sign in with the email on your FurlPay account.",
            style = MaterialTheme.typography.bodyMedium,
        )

        OutlinedTextField(
            value = state.email,
            onValueChange = viewModel::onEmailChanged,
            label = { Text("Email") },
            enabled = !state.codeSent,
            modifier = Modifier.fillMaxWidth(),
        )

        if (state.codeSent) {
            OutlinedTextField(
                value = state.code,
                onValueChange = viewModel::onCodeChanged,
                label = { Text("One-time code") },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        state.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Button(
            onClick = { if (state.codeSent) viewModel.verifyCode() else viewModel.sendCode() },
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.codeSent) "Verify" else "Send code")
        }

        if (state.codeSent) {
            OutlinedButton(onClick = viewModel::reset, modifier = Modifier.fillMaxWidth()) {
                Text("Different email")
            }
        }
    }
}

@Composable
private fun DashboardScreen(viewModel: DashboardViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                text = state.totalUsd?.let { usd(it) } ?: "…",
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 24.dp),
            )
        }
        state.error?.let { error ->
            item { Text(error, color = MaterialTheme.colorScheme.error) }
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = viewModel::syncWatch, enabled = !state.syncing) {
                    Text(if (state.syncing) "Syncing…" else "Sync watch")
                }
                OutlinedButton(onClick = viewModel::signOut) { Text("Sign out") }
            }
        }
        state.syncMessage?.let { message ->
            item { Text(message, style = MaterialTheme.typography.bodySmall) }
        }

        if (state.wallets.isNotEmpty()) {
            item { Text("Wallets", style = MaterialTheme.typography.titleMedium) }
            items(state.wallets, key = { it.id }) { wallet ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            wallet.currency + (wallet.chain?.let { " · $it" } ?: ""),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            usd(wallet.usdValue),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }

        if (state.cards.isNotEmpty()) {
            item { Text("Cards", style = MaterialTheme.typography.titleMedium) }
            items(state.cards, key = { it.id }) { card ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            (card.label ?: card.kind) + " …" + card.last4,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            if (card.frozen) "Frozen" else "Active",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (card.frozen) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                }
            }
        }

        if (state.trips.isNotEmpty()) {
            item { Text("Trips", style = MaterialTheme.typography.titleMedium) }
            items(state.trips, key = { it.id }) { trip ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(trip.title, style = MaterialTheme.typography.bodyMedium)
                        trip.detail?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

private fun usd(n: Double): String = "$" + String.format(java.util.Locale.US, "%,.2f", n)
