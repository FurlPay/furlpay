import java.util.Properties

// FurlPay Watch — Wear OS companion (Pixel Watch 3 target, Wear OS 4+).
// Standalone-capable: the session token syncs from the phone, after which the
// watch talks to furlpay.com directly and degrades to the snapshot cache.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Release signing — see app/mobile/build.gradle.kts for the full rationale.
// The watch APK MUST be signed with the same key as the phone APK: Play rejects
// a Wear/phone pair whose certificates differ, and the Data Layer will not pair
// across them either. Both modules therefore read the same credentials.
data class SigningMaterial(
    val storeFile: File,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String,
)

fun loadSigningMaterial(): SigningMaterial? {
    // See app/mobile: inside the Gradle Kotlin DSL `java` is the plugin
    // extension, so Properties must be imported rather than fully qualified.
    val props = Properties()
    val local = rootProject.file("keystore.properties")
    if (local.exists()) local.inputStream().use { props.load(it) }

    fun value(key: String, env: String): String? =
        props.getProperty(key) ?: System.getenv(env)

    val path = value("storeFile", "GUARDIAN_KEYSTORE_FILE") ?: return null
    val storePassword = value("storePassword", "GUARDIAN_KEYSTORE_PASSWORD") ?: return null
    val alias = value("keyAlias", "GUARDIAN_KEY_ALIAS") ?: return null
    val keyPassword = value("keyPassword", "GUARDIAN_KEY_PASSWORD") ?: return null

    val file = rootProject.file(path)
    if (!file.exists()) {
        logger.warn("Guardian: keystore '{}' is configured but missing — release will be unsigned.", path)
        return null
    }
    return SigningMaterial(file, storePassword, alias, keyPassword)
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

    signingConfigs {
        loadSigningMaterial()?.let { material ->
            create("release") {
                storeFile = material.storeFile
                storePassword = material.storePassword
                keyAlias = material.keyAlias
                keyPassword = material.keyPassword
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    // -----------------------------------------------------------------------
    // Environment flavors — MUST MIRROR app/mobile/build.gradle.kts EXACTLY.
    //
    // The Wearable Data Layer pairs the watch and phone apps by IDENTICAL
    // applicationId. These three suffixes are therefore not a local choice:
    // if `staging` here said ".stg" while the phone said ".staging", the two
    // apps would never see each other and the only symptom would be a watch
    // that shows no data and reports no error — the exact failure the debug
    // build type has always been careful to avoid.
    //
    // A dev watch build pairs with a dev phone build, staging with staging,
    // prod with prod. That is the point: a tester can carry a staging pair on
    // the same wrist and phone as their production pair.
    // -----------------------------------------------------------------------
    flavorDimensions += "environment"

    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            buildConfigField("String", "API_BASE_URL", "\"https://api-dev.furlpay.com/api/\"")
            buildConfigField("String", "FURLPAY_ENV", "\"dev\"")
        }
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField("String", "API_BASE_URL", "\"https://api-staging.furlpay.com/api/\"")
            buildConfigField("String", "FURLPAY_ENV", "\"staging\"")
        }
        create("prod") {
            dimension = "environment"
            // Same production host as app/mobile (see the comment there).
            buildConfigField("String", "API_BASE_URL", "\"https://furlpay.com/api/\"")
            buildConfigField("String", "FURLPAY_ENV", "\"prod\"")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        debug {
            // No applicationIdSuffix — the watch app must keep the same id as
            // the phone app for the Data Layer to pair. See app/mobile. The
            // environment suffix is on the flavor, which both modules share.
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
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
    implementation(libs.wear.remote.interactions)
    implementation(libs.zxing.core)

    // Real asset logos — self-hosted TradingView marks + Duffel airline SVGs
    implementation(libs.coil.compose)
    implementation(libs.coil.svg)
}
