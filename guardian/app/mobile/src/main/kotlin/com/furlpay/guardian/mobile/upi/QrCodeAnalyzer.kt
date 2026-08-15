package com.furlpay.guardian.mobile.upi

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer

/**
 * Decodes QR codes out of CameraX frames with zxing.
 *
 * WHY ZXING AND NOT ML KIT. zxing-core is already a dependency (the watch's
 * QuickPay screen *encodes* QR codes with it), it decodes as well as encodes,
 * and it is a pure-JVM jar. ML Kit's barcode scanner would add a Play-Services
 * dependency and a downloadable model for a job a 200KB library already does.
 *
 * FRAME HANDLING. CameraX yields YUV_420_888; the Y plane alone is the
 * luminance zxing wants, so no colour conversion is needed. `rowStride` is used
 * as the source's data width rather than the image width — they differ whenever
 * the camera pads rows, and using width there produces a sheared image that
 * silently never decodes.
 *
 * The analyzer is stateless per frame and MUST close the ImageProxy on every
 * path, or the pipeline stalls after a handful of frames with no error.
 */
class QrCodeAnalyzer(
    /** Called on the analyzer thread with the decoded text. */
    private val onDecoded: (String) -> Unit,
) : ImageAnalysis.Analyzer {

    private val reader = MultiFormatReader().apply {
        setHints(
            mapOf(
                // QR only: a UPI code is always a QR, and narrowing the format
                // list measurably cuts per-frame work.
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.TRY_HARDER to true,
            ),
        )
    }

    override fun analyze(image: ImageProxy) {
        try {
            decode(image)?.let(onDecoded)
        } catch (_: NotFoundException) {
            // No code in this frame — by far the common case, not an error.
        } catch (_: Exception) {
            // A malformed frame must not kill the pipeline; the next one is
            // milliseconds away.
        } finally {
            image.close()
        }
    }

    private fun decode(image: ImageProxy): String? {
        val plane = image.planes.firstOrNull() ?: return null
        val buffer = plane.buffer
        val data = ByteArray(buffer.remaining())
        buffer.get(data)

        val source = PlanarYUVLuminanceSource(
            data,
            plane.rowStride, // data width — see note above; NOT image.width
            image.height,
            0,
            0,
            image.width,
            image.height,
            false,
        )
        return reader.decodeWithState(BinaryBitmap(HybridBinarizer(source)))?.text
    }
}
