package com.furlpay.guardian.wear

import android.app.Application
import android.content.Context
import com.furlpay.guardian.ai.RepositoryToolExecutor
import com.furlpay.guardian.data.db.GuardianDatabase
import com.furlpay.guardian.data.repository.RoomEventRepository
import com.furlpay.guardian.data.repository.SnapshotStore
import com.furlpay.guardian.network.FurlPayClient
import com.furlpay.guardian.network.repo.FurlPayCardRepository
import com.furlpay.guardian.network.repo.FurlPayMarketRepository
import com.furlpay.guardian.network.repo.FurlPayPortfolioRepository
import com.furlpay.guardian.network.repo.FurlPayTransactionRepository
import com.furlpay.guardian.network.repo.FurlPayTravelRepository
import com.furlpay.guardian.network.repo.FurlPayWalletRepository
import com.furlpay.guardian.security.KeystoreTokenStore
import com.furlpay.guardian.sync.DataLayerManager
import com.furlpay.guardian.sync.MessageRouter

/**
 * Manual service locator — deliberate: Hilt on Wear adds startup cost for a
 * dependency graph this small, and every object here is cheap until first use.
 */
class WearServices(context: Context) {
    val tokenStore = KeystoreTokenStore(context)

    // baseUrl from the build flavor — must be the SAME environment as the
    // paired phone build, which the matched applicationIdSuffix in
    // build.gradle.kts enforces (a dev watch can only pair with a dev phone).
    //
    // onUnauthorized was previously UNSET here, so the watch was the only
    // surface in the product where a 401 did nothing at all: the token stayed
    // in the Keystore, every subsequent call kept failing, and the tiles just
    // showed stale data forever with no way for the user to tell the session
    // had expired. The phone app has wired this since it was written.
    val client = FurlPayClient(
        baseUrl = BuildConfig.API_BASE_URL,
        tokenStore = tokenStore,
        onUnauthorized = {
            // Clear the local copy. The watch has no sign-in UI of its own —
            // recovery is the phone re-pushing a token over the Data Layer —
            // so dropping the dead token is the whole remedy available here,
            // and it is what makes the "signed out" state visible on the tiles
            // instead of an indefinite stale render.
            kotlinx.coroutines.runBlocking { tokenStore.update(null) }
        },
    )

    val walletRepo = FurlPayWalletRepository(client.api)
    val cardRepo = FurlPayCardRepository(client.api)
    val transactionRepo = FurlPayTransactionRepository(client.api)
    val portfolioRepo = FurlPayPortfolioRepository(client.api)
    val travelRepo = FurlPayTravelRepository(client.api)
    val marketRepo = FurlPayMarketRepository(client.api)

    private val db = GuardianDatabase.get(context)
    val eventRepo = RoomEventRepository(db.events())
    val snapshots = SnapshotStore(db.snapshots())

    val dataLayer = DataLayerManager(context)
    val messages = MessageRouter(context)

    /** Verifies that a Data Layer credential came from a connected node. */
    val pairedNodes = com.furlpay.guardian.sync.PairedNodeGate(context)

    /**
     * Local (phone-unreachable) voice fallback. confirmMutating stays at the
     * fail-closed default: the WATCH never executes mutating tools from voice —
     * those need the phone's biometric.
     */
    val toolExecutor = RepositoryToolExecutor(
        wallets = walletRepo,
        cards = cardRepo,
        transactions = transactionRepo,
        portfolio = portfolioRepo,
        travel = travelRepo,
        events = eventRepo,
    )
}

class GuardianWearApp : Application() {
    val services: WearServices by lazy { WearServices(this) }
}

val Context.wearServices: WearServices
    get() = (applicationContext as GuardianWearApp).services
