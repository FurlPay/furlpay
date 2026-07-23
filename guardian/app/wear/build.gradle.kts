// FurlPay Watch — Wear OS companion (Pixel Watch 3 target, Wear OS 4+).
// Standalone-capable: the session token syncs from the phone, after which the
// watch talks to furlpay.com directly and degrades to the snapshot cache.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.furlpay.guardian.wear"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.furlpay.guardian"
        minSdk = 30
        // Google Play requires Wear OS apps to target API 35 or higher; 34 is
        // below the floor and cannot be submitted. Wear is exempt from the
        // API 36 rule that applies to the phone app from 31 Aug 2026, so 35 is
        // both compliant and the highest level compileSdk 35 can target.
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
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
    implementation(project(":core:domain"))
    implementation(project(":core:network"))
    implementation(project(":core:security"))
    implementation(project(":core:sync"))
    implementation(project(":core:data"))
    implementation(project(":core:ai"))

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.datetime)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    // Wear Compose Material 3 (STABLE 1.5.0 — see ARCHITECTURE.md)
    implementation(libs.wear.compose.material3)
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.compose.navigation)

    // Data Layer
    implementation(libs.play.services.wearable)
    implementation(libs.kotlinx.coroutines.play.services)

    // Tiles + complications
    implementation(libs.wear.tiles)
    implementation(libs.wear.protolayout)
    implementation(libs.wear.protolayout.material)
    implementation(libs.watchface.complications.data.source.ktx)
    implementation(libs.kotlinx.coroutines.guava)

    // Ambient mode + QuickPay QR
    implementation(libs.androidx.wear)
    implementation(libs.zxing.core)

    // Real asset logos — self-hosted TradingView marks + Duffel airline SVGs
    implementation(libs.coil.compose)
    implementation(libs.coil.svg)
}
