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
        // 개인 서명키: GitHub secrets 에서 환경변수로 주입된다 (키 파일은 저장소에 두지 않는다).
        val ksFile = System.getenv("NAVIWEB_KEYSTORE_FILE")
        if (!ksFile.isNullOrBlank() && file(ksFile).exists()) {
            create("naviweb") {
                storeFile = file(ksFile)
                storePassword = System.getenv("NAVIWEB_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NAVIWEB_KEY_ALIAS") ?: "naviweb"
                keyPassword = System.getenv("NAVIWEB_KEY_PASSWORD")
            }
        }
    }
    // 개인 서명키가 없으면 서명하지 않은(unsigned) APK 가 나온다 — 공용 키로 서명하지 않는다.
    val sign = signingConfigs.findByName("naviweb")
    buildTypes {
        debug { signingConfig = sign }
        release {
            isMinifyEnabled = false
            signingConfig = sign
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
