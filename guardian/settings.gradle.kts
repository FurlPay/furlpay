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
// AI layer: prompt + tool contracts are pure Kotlin; the Firebase-backed
// clients live in the app modules where the Android/Firebase deps exist.
include(":core:ai")
// App entry points (Android SDK + Firebase required to build these).
include(":app:mobile")
include(":app:wear")
