// FurlPay × Life Guardian AI — Kotlin multi-module project.
// Phone (brain) + Wear OS companion. See docs/ARCHITECTURE.md for the
// verified-API decisions this build is based on.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "guardian"

// Pure-Kotlin core (no Android SDK needed — unit-testable on any JVM).
include(":core:domain")
// Retrofit/OkHttp client for furlpay.com/api — also pure JVM, tested with
// MockWebServer (no emulator in the loop for the money paths).
include(":core:network")
// Android libraries.
include(":core:security") // Keystore-encrypted token store + biometric gate
include(":core:sync")     // Wearable Data Layer (phone ↔ watch)
include(":core:data")     // Room offline cache + DataStore preferences
// AI layer: prompt + tool contracts are pure Kotlin (in :core:domain); the
// Firebase-backed Gemini clients live here as an Android library.
include(":core:ai")
// App entry points (Android SDK required; google-services.json needed only
// at RUNTIME for Firebase — the build stays green without it).
include(":app:mobile")
include(":app:wear")
