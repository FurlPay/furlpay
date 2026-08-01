import java.util.Properties

// Life Guardian phone app — "the brain". Hosts sign-in (email OTP against
// furlpay.com), the dashboard, the watch voice relay, and the FCM client.
// google-services.json is needed only for Firebase AT RUNTIME (Gemini + FCM);
// the build stays green without it and the voice relay falls back to the
// deterministic rule parser.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// google-services.json is gitignored — apply the plugin only when it exists so
// the public repo and CI keep building without the config.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// ---------------------------------------------------------------------------
// Release signing.
//
// Credentials are read from keystore.properties (gitignored) or, for CI, the
// GUARDIAN_KEYSTORE_* environment variables. Nothing secret is committed: the
// file is ignored and the env path leaves no artifact on disk.
//
// When neither source is configured this returns null and the release build is
// left UNSIGNED rather than silently falling back to the debug key. A debug-
// signed release is accepted by `assembleRelease`, installs happily, and is
// rejected by Play only after upload — failing here instead makes the missing
// credential obvious at the point it matters.
// ---------------------------------------------------------------------------
data class SigningMaterial(
    val storeFile: File,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String,
)

fun loadSigningMaterial(): SigningMaterial? {
    // `Properties` is imported at the top of this file: inside the Gradle Kotlin
    // DSL, `java` resolves to the JavaPluginExtension, so `java.util.Properties`
    // does not compile here.
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
    namespace = "com.furlpay.guardian.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.furlpay.guardian"
        minSdk = 26
        // Google Play requires new submissions and updates to target Android 16
        // (API 36) from 31 Aug 2026. 35 would still install but could not be
        // submitted after that date.
        targetSdk = 36
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
                // Play requires the v2+ block; v1 stays on for the API 26 floor.
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            // R8 full mode: shrink code AND resources. A Wear/phone pair ships
            // over the same connection as the watch APK, so size is not vanity.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Only wire the config when credentials actually resolved; otherwise
            // the build stays unsigned and says so, rather than using the debug key.
            signingConfig = signingConfigs.findByName("release")
        }
        debug {
            // NO applicationIdSuffix. The Wearable Data Layer pairs a phone and
            // watch app by IDENTICAL applicationId; suffixing the phone's debug
            // build silently breaks pairing, and the symptom (watch shows no
            // data) looks like a sync bug rather than a build-config one.
            versionNameSuffix = "-debug"
        }
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
    implementation(libs.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    // Watch relay
    implementation(libs.play.services.wearable)
    implementation(libs.kotlinx.coroutines.play.services)

    // Periodic background sync (events → alarms → watch)
    implementation(libs.work.runtime)

    // FCM client (server side already live — lib/fcm.ts)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    // The src/test source set existed but had no dependencies, so anything put
    // in it would silently fail to compile. These are the same two the domain
    // module already uses.
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}
