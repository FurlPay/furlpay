// Wearable Data Layer: the ONLY channel between phone (brain) and watch.
// SyncProtocol is the single source of truth for paths + payload shapes, so
// the two apps can never drift apart on the wire format.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.furlpay.guardian.sync"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    api(project(":core:domain"))

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.play.services.wearable)
    implementation(libs.kotlinx.coroutines.play.services)

    // This module had NO tests, and it owns the phone/watch wire format — the
    // one place a field carrying a credential or a wallet address would silently
    // start crossing to a device with a weaker lock screen and a plaintext cache.
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}
