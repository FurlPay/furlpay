package com.furlpay.guardian.wear.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.view.WindowManager
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.furlpay.guardian.wear.viewmodel.QuickPayViewModel
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Receive QR — the one thing that must work with no phone, no network, and a
 * stranger's camera pointed at your wrist. White quiet zone is mandatory for
 * scanners; it's the single deliberate exception to the pure-black rule.
 *
 * While the QR is up the display is pinned awake at full brightness — a watch
 * that dims or drops to ambient mid-scan is a failed payment. Both overrides
 * release the moment the screen leaves composition.
 */
@Composable
fun QuickPayScreen(viewModel: QuickPayViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    ScreenScaffold {
        Column(
            modifier = Modifier.fillMaxSize().padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when {
                state.loading -> CircularProgressIndicator(
                    modifier = Modifier.padding(top = 48.dp),
                )

                state.address != null -> {
                    val address = state.address!!
                    ScanBrightness()
                    // ~102k pixels — encoded off the main thread, not in
                    // composition (the setPixel loop was a visible jank spike).
                    val qr by produceState<Bitmap?>(initialValue = null, address) {
                        value = withContext(Dispatchers.Default) { qrBitmap(address, sizePx = 320) }
                    }
                    qr?.let { bitmap ->
                        Image(
                            bitmap = bitmap.asImageBitmap(),
                            contentDescription = "Receive address QR",
                            contentScale = ContentScale.Fit,
                            // Nearest-neighbor keeps QR modules crisp — a blurred
                            // module boundary is a failed scan.
                            filterQuality = FilterQuality.None,
                            modifier = Modifier
                                .padding(top = 20.dp)
                                .size(132.dp)
                                .background(
                                    androidx.compose.ui.graphics.Color.White,
                                    RoundedCornerShape(8.dp),
                                )
                                .padding(4.dp),
                        )
                    } ?: CircularProgressIndicator(modifier = Modifier.padding(top = 48.dp))
                    Text(
                        text = shortAddress(address),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }

                else -> Text(
                    text = state.error ?: "No address",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 48.dp),
                )
            }
        }
    }
}

/**
 * Full brightness + keep-screen-on for as long as the caller is composed.
 * Restores the previous window state on dispose (swipe-back, QR gone, etc.).
 */
@Composable
private fun ScanBrightness() {
    val context = LocalContext.current
    DisposableEffect(context) {
        val window = context.findActivity()?.window
        val previous = window?.attributes?.screenBrightness
        window?.let {
            it.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            val lp = it.attributes
            lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
            it.attributes = lp
        }
        onDispose {
            window?.let {
                it.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                val lp = it.attributes
                lp.screenBrightness =
                    previous ?: WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                it.attributes = lp
            }
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** "0x7045…a31e" */
private fun shortAddress(address: String): String =
    if (address.length > 12) {
        address.take(6) + "…" + address.takeLast(4).lowercase(Locale.US)
    } else address

private fun qrBitmap(content: String, sizePx: Int): Bitmap {
    val matrix = QRCodeWriter().encode(
        content,
        BarcodeFormat.QR_CODE,
        sizePx,
        sizePx,
        mapOf(
            EncodeHintType.MARGIN to 1,
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
        ),
    )
    // Bulk row writes — one allocation, one copy, no 102k-call setPixel loop.
    val pixels = IntArray(sizePx * sizePx)
    for (y in 0 until sizePx) {
        val row = y * sizePx
        for (x in 0 until sizePx) {
            pixels[row + x] = if (matrix[x, y]) AndroidColor.BLACK else AndroidColor.WHITE
        }
    }
    return Bitmap.createBitmap(pixels, sizePx, sizePx, Bitmap.Config.RGB_565)
}
