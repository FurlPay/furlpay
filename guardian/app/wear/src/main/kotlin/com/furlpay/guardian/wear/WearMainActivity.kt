package com.furlpay.guardian.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.furlpay.guardian.wear.complication.ComplicationLockReceiver
import com.furlpay.guardian.wear.complication.ComplicationPrivacy
import com.furlpay.guardian.wear.tile.EXTRA_ROUTE
import com.furlpay.guardian.wear.ui.CardsScreen
import com.furlpay.guardian.wear.ui.HomeScreen
import com.furlpay.guardian.wear.ui.MarketsScreen
import com.furlpay.guardian.wear.ui.PortfolioScreen
import com.furlpay.guardian.wear.ui.QuickPayScreen
import com.furlpay.guardian.wear.ui.SpendingScreen
import com.furlpay.guardian.wear.ui.StockScreen
import com.furlpay.guardian.wear.ui.TravelScreen
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

    /** Route requests arriving while the activity is alive (tile taps). */
    private val pendingRoute = mutableStateOf<String?>(null)

    /**
     * Re-renders the money complications when the watch is unlocked.
     *
     * They redact themselves while the device is locked, and the watch-face
     * system caches whatever a provider last returned — so without a nudge on
     * unlock a user would keep seeing dots long after unlocking. Registered
     * here rather than in the manifest because ACTION_USER_PRESENT and
     * ACTION_SCREEN_ON are not delivered to manifest-declared receivers.
     */
    private val lockReceiver = ComplicationLockReceiver()

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

        // FLAG_SECURE, for the same reason app/mobile sets it: every screen
        // here shows balances, card last-4s or holdings, and none of them is
        // something a user needs to screenshot. The phone app had this from the
        // start and the watch did not, so the watch's recents thumbnail and any
        // screen-recording service kept a legible copy of the wallet.
        //
        // Wear OS honours the flag the same way the phone does — this is not a
        // no-op on a small screen.
        window.setFlags(
            android.view.WindowManager.LayoutParams.FLAG_SECURE,
            android.view.WindowManager.LayoutParams.FLAG_SECURE,
        )

        lifecycle.addObserver(ambientObserver)

        // RECEIVER_NOT_EXPORTED: these are system broadcasts and nothing else
        // may send them to us. Required from API 34 and correct before it.
        androidx.core.content.ContextCompat.registerReceiver(
            this,
            lockReceiver,
            ComplicationLockReceiver.filter,
            androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        val start = intent?.getStringExtra(EXTRA_ROUTE)
            ?.takeIf { it in VALID_ROUTES }
            ?: Routes.HOME

        setContent {
            val ambient by isAmbient
            val routeRequest by pendingRoute
            GuardianWearUi(
                startDestination = start,
                ambient = ambient,
                routeRequest = routeRequest,
                onRouteConsumed = { pendingRoute.value = null },
            )
        }
    }

    override fun onDestroy() {
        unregisterReceiver(lockReceiver)
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        // The app being in the foreground means the watch is unlocked, and the
        // complications may have redacted themselves while it was not.
        ComplicationPrivacy.requestRefresh(this)
    }

    // A tile tap while the app is already open lands here, not onCreate —
    // without this the intent's route was silently ignored (found in the
    // Jul 17 emulator run).
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_ROUTE)
            ?.takeIf { it in VALID_ROUTES }
            ?.let { pendingRoute.value = it }
    }

    private companion object {
        val VALID_ROUTES = setOf(
            Routes.HOME, Routes.WALLET, Routes.CARDS,
            Routes.VOICE, Routes.PORTFOLIO, Routes.SPENDING, Routes.QUICKPAY,
            Routes.MARKETS, Routes.TRAVEL,
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
    const val MARKETS = "markets"
    const val TRAVEL = "travel"
}

@Composable
fun GuardianWearUi(
    startDestination: String = Routes.HOME,
    ambient: Boolean = false,
    routeRequest: String? = null,
    onRouteConsumed: () -> Unit = {},
) {
    GuardianTheme {
        AppScaffold(
            timeText = { TimeText() },
            // Ambient: dim, don't blank — the metric stays readable and the
            // AMOLED cost of dimmed off-white text on black is negligible.
            modifier = Modifier.alpha(if (ambient) 0.55f else 1f),
        ) {
            val navController = rememberSwipeDismissableNavController()

            // Tile deep-link while already open (onNewIntent) → navigate now.
            LaunchedEffect(routeRequest) {
                routeRequest?.let {
                    navController.navigate(it) { popUpTo(Routes.HOME) }
                    onRouteConsumed()
                }
            }

            SwipeDismissableNavHost(
                navController = navController,
                startDestination = startDestination,
            ) {
                composable(Routes.HOME) { HomeScreen(navController) }
                composable(Routes.WALLET) {
                    WalletScreen(onReceive = { navController.navigate(Routes.QUICKPAY) })
                }
                composable(Routes.CARDS) { CardsScreen() }
                composable(Routes.VOICE) { VoiceScreen() }
                composable(Routes.PORTFOLIO) { PortfolioScreen(navController) }
                composable(Routes.SPENDING) { SpendingScreen() }
                composable(Routes.QUICKPAY) { QuickPayScreen() }
                composable(Routes.MARKETS) { MarketsScreen(navController) }
                composable("stock/{symbol}") { backStack ->
                    StockScreen(symbol = backStack.arguments?.getString("symbol") ?: "")
                }
                composable(Routes.TRAVEL) { TravelScreen() }
            }
        }
    }
}
