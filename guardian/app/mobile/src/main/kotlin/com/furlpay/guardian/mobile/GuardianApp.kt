package com.furlpay.guardian.mobile

import android.app.Application
import android.content.Context
import com.furlpay.guardian.ai.GeminiTextAssistant
import com.furlpay.guardian.ai.RepositoryToolExecutor
import com.furlpay.guardian.data.db.GuardianDatabase
import com.furlpay.guardian.data.repository.RoomEventRepository
import com.furlpay.guardian.data.repository.SnapshotStore
import com.furlpay.guardian.network.FurlPayClient
import com.furlpay.guardian.network.repo.FurlPayCardRepository
import com.furlpay.guardian.network.repo.FurlPayPortfolioRepository
import com.furlpay.guardian.network.repo.FurlPayTransactionRepository
import com.furlpay.guardian.network.repo.FurlPayTravelRepository
import com.furlpay.guardian.network.repo.FurlPayWalletRepository
import com.furlpay.guardian.mobile.alarm.GuardianAlarmScheduler
import com.furlpay.guardian.security.AuthManager
import com.furlpay.guardian.security.KeystoreTokenStore
import com.furlpay.guardian.sync.DataLayerManager
import com.furlpay.guardian.sync.MessageRouter
import com.google.firebase.FirebaseApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Manual DI — same rationale as the watch: tiny graph, fast startup. */
class MobileServices(context: Context) {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val tokenStore = KeystoreTokenStore(context)
    val authManager = AuthManager(tokenStore, appScope)
    val client = FurlPayClient(
        tokenStore = tokenStore,
        onUnauthorized = { authManager.onUnauthorized() },
    )

    val walletRepo = FurlPayWalletRepository(client.api)
    val cardRepo = FurlPayCardRepository(client.api)
    val transactionRepo = FurlPayTransactionRepository(client.api)
    val portfolioRepo = FurlPayPortfolioRepository(client.api)
    val travelRepo = FurlPayTravelRepository(client.api)

    private val db = GuardianDatabase.get(context)
    val eventRepo = RoomEventRepository(db.events())
    val snapshots = SnapshotStore(db.snapshots())

    val dataLayer = DataLayerManager(context)
    val messages = MessageRouter(context)
    val alarmScheduler = GuardianAlarmScheduler(context)
    val sync = SyncCoordinator(this)

    /**
     * Background relay executor. confirmMutating stays fail-closed: a relayed
     * watch command has no Activity to show a biometric on, so mutating tools
     * refuse and tell the user to confirm on the phone.
     */
    val relayExecutor = RepositoryToolExecutor(
        wallets = walletRepo,
        cards = cardRepo,
        transactions = transactionRepo,
        portfolio = portfolioRepo,
        travel = travelRepo,
        events = eventRepo,
    )

    /** Whether google-services.json shipped (Firebase runtime available). */
    val firebaseConfigured: Boolean get() = FirebaseApp.getApps(appContext).isNotEmpty()

    /** Gemini brain — only touch when [firebaseConfigured]. */
    val gemini: GeminiTextAssistant by lazy { GeminiTextAssistant(relayExecutor) }

    private val appContext = context.applicationContext
}

class GuardianApp : Application() {
    val services: MobileServices by lazy { MobileServices(this) }

    override fun onCreate() {
        super.onCreate()
        // Periodic sync heartbeat (15 min) — refreshes snapshots on the watch
        // and re-arms alarm ladders (AlarmManager state does not survive
        // reboot; the next heartbeat restores it).
        com.furlpay.guardian.mobile.service.GuardianSyncWorker.schedule(this)
    }
}

val Context.mobileServices: MobileServices
    get() = (applicationContext as GuardianApp).services
