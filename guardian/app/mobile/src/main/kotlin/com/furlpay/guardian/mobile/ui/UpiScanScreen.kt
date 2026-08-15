package com.furlpay.guardian.mobile.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.furlpay.guardian.domain.upi.UpiPaymentRequest
import com.furlpay.guardian.mobile.upi.QrCodeAnalyzer
import com.furlpay.guardian.mobile.upi.UpiIntentLauncher
import java.math.BigDecimal
import java.util.concurrent.Executors

/**
 * Scan a merchant's UPI QR and hand the payment to the user's UPI app.
 *
 * India's merchant payments are QR-first, so before this Guardian could not pay
 * at a shop at all. The flow is deliberately two-step — scan, then confirm —
 * because of what a QR can claim: see [UpiConfirmCard].
 */
@Composable
fun UpiScanScreen(onClose: () -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(hasCameraPermission(context)) }
    var scanned by remember { mutableStateOf<UpiPaymentRequest?>(null) }
    var badQr by remember { mutableStateOf(false) }

    val requestPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted = it }

    LaunchedEffect(Unit) {
        if (!granted) requestPermission.launch(Manifest.permission.CAMERA)
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            scanned != null -> UpiConfirmCard(
                request = scanned!!,
                onDone = onClose,
                onCancel = { scanned = null; badQr = false },
            )

            !granted -> PermissionExplainer(
                onGrant = { requestPermission.launch(Manifest.permission.CAMERA) },
                onClose = onClose,
            )

            else -> Column(modifier = Modifier.fillMaxSize()) {
                CameraPreview(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    onCode = { code ->
                        // Ignore anything that is not UPI: this scanner has one
                        // job, and silently routing an unrelated QR somewhere
                        // would be worse than not reacting.
                        val parsed = UpiPaymentRequest.fromUri(code)
                        when {
                            parsed != null -> { scanned = parsed; badQr = false }
                            UpiPaymentRequest.looksLikeUpi(code) -> badQr = true
                            else -> Unit
                        }
                    },
                )
                Column(
                    modifier = Modifier.fillMaxWidth().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        if (badQr) {
                            "That UPI code is damaged or incomplete — ask for a fresh one."
                        } else {
                            "Point at a merchant's UPI QR code."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (badQr) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        textAlign = TextAlign.Center,
                    )
                    OutlinedButton(onClick = onClose) { Text("Cancel") }
                }
            }
        }
    }
}

@Composable
private fun CameraPreview(modifier: Modifier = Modifier, onCode: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    // One background thread for analysis; frames are dropped rather than queued
    // so a slow decode can never build a backlog behind the preview.
    val executor = remember { Executors.newSingleThreadExecutor() }

    DisposableEffect(Unit) {
        onDispose {
            executor.shutdown()
            // Release the camera when the screen goes away — leaving it bound
            // keeps the indicator lit and blocks other apps.
            runCatching { ProcessCameraProvider.getInstance(context).get().unbindAll() }
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val future = ProcessCameraProvider.getInstance(ctx)
            future.addListener({
                val provider = future.get()
                val preview = Preview.Builder().build()
                    .also { it.surfaceProvider = previewView.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { it.setAnalyzer(executor, QrCodeAnalyzer(onCode)) }

                runCatching {
                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                }
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
    )
}

/**
 * Confirmation before handing off to a UPI app.
 *
 * SECURITY — WHY THIS SCREEN EXISTS. Everything a QR encodes except the VPA is
 * attacker-controlled: a code taped over a merchant's real one can carry any
 * name and any amount. So the VPA is shown with the same weight as the name and
 * is never hidden behind it, and the amount is shown before, not after, the tap.
 */
@Composable
private fun UpiConfirmCard(
    request: UpiPaymentRequest,
    onDone: () -> Unit,
    onCancel: () -> Unit,
) {
    val context = LocalContext.current
    var amountText by remember { mutableStateOf(request.amount?.toPlainString().orEmpty()) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Paying via UPI", style = MaterialTheme.typography.labelLarge)

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    request.payeeName ?: "Unknown payee",
                    style = MaterialTheme.typography.titleLarge,
                    textAlign = TextAlign.Center,
                )
                Text(request.payeeVpa, style = MaterialTheme.typography.titleSmall)
                Text(
                    "Check this UPI ID matches the merchant before paying.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }

        if (request.hasFixedAmount) {
            Text("₹${request.amount!!.toPlainString()}", style = MaterialTheme.typography.displaySmall)
        } else {
            OutlinedTextField(
                value = amountText,
                onValueChange = { amountText = it; error = null },
                label = { Text("Amount (₹)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        request.transactionNote?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
        }

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Button(
            onClick = {
                val override = if (request.hasFixedAmount) {
                    null
                } else {
                    amountText.trim().toBigDecimalOrNull()?.takeIf(UpiPaymentRequest::isPayableAmount)
                        ?: run {
                            error = "Enter an amount in rupees, e.g. 250 or 250.50"
                            return@Button
                        }
                }
                when (val result = UpiIntentLauncher.launch(context, request, override)) {
                    is UpiIntentLauncher.Result.Launched -> onDone()
                    is UpiIntentLauncher.Result.NoUpiApp ->
                        error = "No UPI app found. Install GPay, PhonePe, or any bank UPI app."
                    is UpiIntentLauncher.Result.Invalid -> error = result.reason
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Pay with UPI")
        }

        Text(
            "Your UPI app completes this payment from your bank account. " +
                "FurlPay does not hold or move these funds.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Scan a different code") }
    }
}

@Composable
private fun PermissionExplainer(onGrant: () -> Unit, onClose: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Guardian needs camera access to scan UPI QR codes.",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
        Button(onClick = onGrant) { Text("Allow camera") }
        OutlinedButton(onClick = onClose) { Text("Not now") }
    }
}

private fun hasCameraPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED
