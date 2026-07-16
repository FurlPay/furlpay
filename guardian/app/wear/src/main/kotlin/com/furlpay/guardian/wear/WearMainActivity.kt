package com.furlpay.guardian.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.furlpay.guardian.wear.ui.CardsScreen
import com.furlpay.guardian.wear.ui.HomeScreen
import com.furlpay.guardian.wear.ui.VoiceScreen
import com.furlpay.guardian.wear.ui.WalletScreen

/**
 * Single-activity Compose host. Navigation stays two levels deep maximum
 * (home → detail); swipe-right always goes back — never overridden.
 */
class WearMainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { GuardianWearUi() }
    }
}

object Routes {
    const val HOME = "home"
    const val WALLET = "wallet"
    const val CARDS = "cards"
    const val VOICE = "voice"
}

@Composable
fun GuardianWearUi() {
    MaterialTheme {
        AppScaffold(timeText = { TimeText() }) {
            val navController = rememberSwipeDismissableNavController()
            SwipeDismissableNavHost(
                navController = navController,
                startDestination = Routes.HOME,
            ) {
                composable(Routes.HOME) { HomeScreen(navController) }
                composable(Routes.WALLET) { WalletScreen() }
                composable(Routes.CARDS) { CardsScreen() }
                composable(Routes.VOICE) { VoiceScreen() }
            }
        }
    }
}
