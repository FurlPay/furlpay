package com.furlpay.guardian.wear.ui

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.decode.SvgDecoder

/**
 * Watch port of the native <AssetLogo>: the two-letter monogram renders
 * instantly and always; the real SVG mark (a furlpay.com self-hosted logo
 * path or a Duffel airline CDN URL) draws over it when it loads. A row is
 * never blank and never a broken-image box.
 */
private const val ORIGIN = "https://furlpay.com"

private var svgLoader: ImageLoader? = null

private fun loaderFor(context: Context): ImageLoader =
    svgLoader ?: ImageLoader.Builder(context)
        .components { add(SvgDecoder.Factory()) }
        .build()
        .also { svgLoader = it }

@Composable
fun AssetLogo(
    symbol: String,
    logoPath: String?,
    modifier: Modifier = Modifier,
    size: Dp = 30.dp,
) {
    val context = LocalContext.current
    MonogramTile(symbol = symbol, modifier = modifier, size = size) {
        if (logoPath != null) {
            val url = if (logoPath.startsWith("http")) logoPath else ORIGIN + logoPath
            Box(modifier = Modifier.fillMaxSize()) {
                AsyncImage(
                    model = url,
                    imageLoader = loaderFor(context),
                    contentDescription = symbol,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}
