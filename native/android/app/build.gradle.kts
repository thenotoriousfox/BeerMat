import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Release signing, as the Capacitor app: keystore.properties next to this project (never committed).
val signing = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "uk.beermat.player"
    compileSdk = 36

    defaultConfig {
        // The same id as the Capacitor app, so the native app installs over it once it replaces it. Debug builds add
        // .next so both can be installed side by side while the native app is tested.
        applicationId = "uk.beermat.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 607
        versionName = "0.5.7"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // BeerMat Online and the venue list, as mobile/www/config.js (a player can change the service under Profile).
        buildConfigField("String", "ONLINE_SERVICE", "\"${project.findProperty("onlineService") ?: "https://online.beermatquiz.co.uk"}\"")
        buildConfigField("String", "VENUE_LIST", "\"https://raw.githubusercontent.com/DTJW92/BeerMat/main/venues.json\"")
        // Updates from BeerMat's website (update/Updates.kt). A store build (-PstoreBuild) leaves them to the store.
        buildConfigField("String", "DOWNLOADS", "\"https://downloads.beermatquiz.co.uk\"")
        buildConfigField("boolean", "SELF_UPDATE", "${project.findProperty("storeBuild") == null}")
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) create("release") {
            storeFile = rootProject.file(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".next"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true; buildConfig = true }
    testOptions { unitTests.isReturnDefaultValues = true }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    val compose = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(compose)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // Google's code scanner: the camera runs in Play services, so the app needs no camera permission.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    // The map of venues: OpenStreetMap tiles, loaded only while the map is open.
    implementation("org.osmdroid:osmdroid-android:6.1.20")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(compose)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    // org.json is part of Android; unit tests on the JVM need a real copy.
    testImplementation("org.json:json:20260522")
}
