package com.furlpay.guardian.wear.ui

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.wear.viewmodel.VoiceViewModel

/**
 * Ask Guardian. Button-triggered system SpeechRecognizer — NO always-listening
 * wake word (battery). Text relays to the phone brain; falls back to the
 * on-watch rule parser when the phone is out of reach.
 */
@Composable
fun VoiceScreen(viewModel: VoiceViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val text = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
        if (result.resultCode == Activity.RESULT_OK && text != null) {
            viewModel.onSpeech(text)
        } else {
            viewModel.onSpeechCancelled()
        }
    }

    fun startListening() {
        viewModel.onListening()
        speechLauncher.launch(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask Guardian")
            },
        )
    }

    ScreenScaffold {
        Box(
            modifier = Modifier.fillMaxSize().padding(12.dp),
            contentAlignment = Alignment.Center,
        ) {
            when (val current = state) {
                is VoiceViewModel.UiState.Idle,
                is VoiceViewModel.UiState.Listening,
                -> Button(onClick = ::startListening, modifier = Modifier.fillMaxWidth()) {
                    Text("🎤 Tap to speak", textAlign = TextAlign.Center)
                }

                is VoiceViewModel.UiState.Processing -> CircularProgressIndicator()

                is VoiceViewModel.UiState.Responding -> Card(
                    onClick = viewModel::dismissResponse,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = current.text,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                is VoiceViewModel.UiState.Error -> Card(
                    onClick = ::startListening,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = current.message,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}
