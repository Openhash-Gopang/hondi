import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val fb = Properties().apply {
    val f = file("firebase-config.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun fbv(k: String) = (fb.getProperty(k) ?: "").trim()

android {
    namespace = "kr.naviweb.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "kr.naviweb.app"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("NAVIWEB_VERSION_CODE") ?: "1").toInt()
        versionName = "0.1.0"
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${fbv("FIREBASE_PROJECT_ID")}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${fbv("FIREBASE_SENDER_ID")}\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"${fbv("FIREBASE_APP_ID")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${fbv("FIREBASE_API_KEY")}\"")
        buildConfigField("String", "WEB_ORIGIN", "\"https://naviweb.kr\"")
    }

    signingConfigs {
        // 시험용 키(저장소에 공개). Play 출시는 Play App Signing 을 쓰므로 이 키로 올리지 않는다.
        create("test") {
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "navidebug"
            keyPassword = "android"
        }
    }
    buildTypes {
        debug { signingConfig = signingConfigs.getByName("test") }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("test")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-messaging")
}
