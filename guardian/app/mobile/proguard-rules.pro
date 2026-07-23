# Guardian phone — R8 rules.
#
# Every rule here exists because R8 in full mode removes or renames something
# that is only reached reflectively, and the resulting failure appears at
# RUNTIME in a release build that debug builds never reproduce. Each block says
# what breaks without it.

# --- kotlinx.serialization --------------------------------------------------
# The compiler plugin generates a `Companion.serializer()` per @Serializable
# class. Nothing calls it from Kotlin source, so R8 sees dead code and strips
# it; the app then throws SerializationException on the first API response.
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault

# --- Retrofit + OkHttp ------------------------------------------------------
# Retrofit builds its implementation from the interface's generic signatures and
# annotations at runtime. Without Signature the parsed return type collapses to
# raw Call and every request fails to deserialize.
-keepattributes Signature,InnerClasses,EnclosingMethod,Exceptions
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# The API surface is a Retrofit interface — keep its annotations intact.
-keep interface com.furlpay.guardian.network.** { *; }

# --- DTOs -------------------------------------------------------------------
# Serialized wire models: field names ARE the JSON contract, so renaming them
# silently changes the payload.
-keep class com.furlpay.guardian.network.dto.** { *; }

# --- Hilt / Dagger ----------------------------------------------------------
-dontwarn dagger.hilt.**
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }

# --- Room -------------------------------------------------------------------
-keep class androidx.room.** { *; }
-keep @androidx.room.Entity class * { *; }
-dontwarn androidx.room.paging.**

# --- Firebase / Gemini ------------------------------------------------------
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# --- Wearable Data Layer ----------------------------------------------------
# Services are instantiated by the framework from the manifest by name.
-keep class * extends com.google.android.gms.wearable.WearableListenerService { *; }
-keep class com.google.android.gms.wearable.** { *; }
-dontwarn com.google.android.gms.**

# --- Crash readability ------------------------------------------------------
# Keep line numbers, then hide the original file name so stack traces stay
# mappable without leaking source paths.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
