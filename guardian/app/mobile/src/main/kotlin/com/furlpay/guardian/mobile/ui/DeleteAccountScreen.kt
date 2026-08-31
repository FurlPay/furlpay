package com.furlpay.guardian.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.furlpay.guardian.mobile.viewmodel.DeleteAccountViewModel

/**
 * In-app account deletion — the Google Play requirement this app did not meet.
 *
 * Ported from native-app/app/delete-account.tsx, and it keeps that screen's two
 * properties rather than only its layout:
 *
 *  * The "kept" list is rendered from the SERVER's retention notice, so the app
 *    cannot promise an erasure the API does not perform.
 *  * Deletion is gated on a fresh login code, because the server gates it on a
 *    session-bound step-up. A stolen phone with a live session cannot erase the
 *    account.
 *
 * The self-custodial wallet opt-out from the RN screen has no counterpart here:
 * this app holds no recovery phrase, so there is no on-device key material for a
 * deletion to destroy.
 */
@Composable
fun DeleteAccountScreen(
    onDeleted: () -> Unit,
    onBack: () -> Unit,
    viewModel: DeleteAccountViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // The account is gone and the session is cleared; hand control back so the
    // shell can return to the login screen.
    LaunchedEffect(state.step) {
        if (state.step == DeleteAccountViewModel.Step.Deleted) onDeleted()
    }

    if (state.step == DeleteAccountViewModel.Step.Loading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                text = "Delete your account",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 24.dp),
            )
        }

        item {
            Text("This will be deleted", style = MaterialTheme.typography.titleMedium)
        }
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "Your profile and contact details, sign-ins, balances, cards, " +
                        "transaction history, trips, reminders and push registrations. You " +
                        "will be signed out on every device, including your watch, and will " +
                        "not be able to sign in again.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }

        if (state.retained.isNotEmpty()) {
            item {
                Text("This will be kept", style = MaterialTheme.typography.titleMedium)
            }
            // Straight from the server's retention notice — the reasons are
            // regulatory (AML records, tax documents) and are not the app's to
            // paraphrase.
            items(state.retained, key = { it.record }) { retained ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(retained.record, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            text = retained.reason,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        state.error?.let { error ->
            item { Text(error, color = MaterialTheme.colorScheme.error) }
        }

        when (state.step) {
            DeleteAccountViewModel.Step.NeedsCode -> item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = state.email?.let {
                            "Confirm it's you. We'll email a code to $it."
                        } ?: "Confirm it's you before deleting this account.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Button(
                        onClick = viewModel::sendCode,
                        enabled = !state.busy && state.email != null,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (state.busy) "Sending…" else "Email me a code")
                    }
                }
            }

            DeleteAccountViewModel.Step.CodeSent -> item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = state.code,
                        onValueChange = viewModel::onCodeChanged,
                        label = { Text("Code from your email") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = viewModel::verifyCode,
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (state.busy) "Verifying…" else "Verify")
                    }
                }
            }

            DeleteAccountViewModel.Step.Review -> item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Type DELETE to confirm. This cannot be undone.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedTextField(
                        value = state.confirmText,
                        onValueChange = viewModel::onConfirmTextChanged,
                        label = { Text("DELETE") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = viewModel::delete,
                        // `armed` is the ViewModel's gate, not a second copy of
                        // the rule here — one place decides whether this may run.
                        enabled = state.armed,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Delete my account permanently")
                    }
                }
            }

            DeleteAccountViewModel.Step.Deleting -> item {
                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }

            DeleteAccountViewModel.Step.Loading,
            DeleteAccountViewModel.Step.Deleted -> Unit
        }

        item {
            OutlinedButton(
                onClick = onBack,
                enabled = state.step != DeleteAccountViewModel.Step.Deleting,
                modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp),
            ) {
                Text("Keep my account")
            }
        }
    }
}
