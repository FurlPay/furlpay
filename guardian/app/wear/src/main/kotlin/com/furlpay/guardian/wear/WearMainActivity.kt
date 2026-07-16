package com.furlpay.guardian.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.wear.ambient.AmbientLifecycleObserver
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.furlpay.guardian.wear.tile.EXTRA_ROUTE
import com.furlpay.guardian.wear.ui.CardsScreen
import com.furlpay.guardian.wear.ui.HomeScreen
import com.furlpay.guardian.wear.ui.PortfolioScreen
import com.furlpay.guardian.wear.ui.QuickPayScreen
import com.furlpay.guardian.wear.ui.SpendingScreen
import com.furlpay.guardian.wear.ui.VoiceScreen
import com.furlpay.guardian.wear.ui.WalletScreen
import com.furlpay.guardian.wear.ui.theme.GuardianTheme

/**
 * Single-activity Compose host. Navigation stays two levels deep maximum
 * (home → detail); swipe-right always goes back — never overridden.
 *
 * Tiles deep-link straight to their screen via the EXTRA_ROUTE intent extra
 * ("one screen, one action" — a tile tap must not land on a menu). Ambient
 * mode dims the whole surface instead of going blank: glanceable content is
 * exactly what ambient is for.
 */
class WearMainActivity : ComponentActivity() {

    private val isAmbient = mutableStateOf(false)

    private val ambientObserver = AmbientLifecycleObserver(
        this,
        object : AmbientLifecycleObserver.AmbientLifecycleCallback {
            override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
                isAmbient.value = true
            }

            override fun onExitAmbient() {
                isAmbient.value = false
            }
        },
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(ambientObserver)

        val start = intent?.getStringExtra(EXTRA_ROUTE)
            ?.takeIf { it in VALID_ROUTES }
            ?: Routes.HOME

        setContent {
            val ambient by isAmbient
            GuardianWearUi(startDestination = start, ambient = ambient)
        }
    }

    private companion object {
        val VALID_ROUTES = setOf(
            Routes.HOME, Routes.WALLET, Routes.CARDS,
            Routes.VOICE, Routes.PORTFOLIO, Routes.SPENDING, Routes.QUICKPAY,
        )
    }
}

object Routes {
    const val HOME = "home"
    const val WALLET = "wallet"
    const val CARDS = "cards"
    const val VOICE = "voice"
    const val PORTFOLIO = "portfolio"
    const val SPENDING = "spending"
    const val QUICKPAY = "quickpay"
}

@Composable
fun GuardianWearUi(startDestination: String = Routes.HOME, ambient: Boolean = false) {
    GuardianTheme {
        AppScaffold(
            timeText = { TimeText() },
            // Ambient: dim, don't blank — the metric stays readable and the
            // AMOLED cost of dimmed off-white text on black is negligible.
            modifier = Modifier.alpha(if (ambient) 0.55f else 1f),
        ) {
            val navController = rememberSwipeDismissableNavController()
            SwipeDismissableNavHost(
                navController = navController,
                startDestination = startDestination,
            ) {
                composable(Routes.HOME) { HomeScreen(navController) }
                composable(Routes.WALLET) { WalletScreen() }
                composable(Routes.CARDS) { CardsScreen() }
                composable(Routes.VOICE) { VoiceScreen() }
                composable(Routes.PORTFOLIO) { PortfolioScreen() }
                composable(Routes.SPENDING) { SpendingScreen() }
                composable(Routes.QUICKPAY) { QuickPayScreen() }
            }
        }
    }
}
