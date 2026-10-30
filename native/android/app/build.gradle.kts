import java.util.Properties
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory

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
        versionCode = 611
        versionName = "0.6.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // BeerMat Online and the venue list, as mobile/www/config.js.
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

// licences.txt in the app's assets: every library in the release build with the licence its own POM names (and the
// notices Play services libraries carry inside), then the Apache 2.0 text most of them use. Worked out at build time,
// so it follows the dependencies above.
val licencesDir = layout.buildDirectory.dir("generated/licences")
val writeLicences by tasks.registering {
    val apache = rootProject.file("../packaging/licences/apache-2.0.txt")
    inputs.file(apache)
    inputs.property("version", android.defaultConfig.versionName ?: "")
    outputs.dir(licencesDir)
    doLast {
        val modules = configurations.getByName("releaseRuntimeClasspath").incoming.resolutionResult.allComponents
            .mapNotNull { it.id as? org.gradle.api.artifacts.component.ModuleComponentIdentifier }
            .sortedBy { "${it.group}:${it.module}" }
        fun resolve(notation: String) = configurations.detachedConfiguration(dependencies.create(notation)).apply { isTransitive = false }
            .resolvedConfiguration.lenientConfiguration.artifacts.firstOrNull()?.file
        val xml = DocumentBuilderFactory.newInstance()
        // A POM without licences takes them from its parent's.
        fun licencesOf(pom: File?): List<String> {
            pom ?: return emptyList()
            val doc = xml.newDocumentBuilder().parse(pom)
            fun tag(e: org.w3c.dom.Element, name: String) = e.getElementsByTagName(name).item(0)?.textContent?.trim().orEmpty()
            val nodes = doc.getElementsByTagName("license")
            val named = (0 until nodes.length).map { i ->
                val e = nodes.item(i) as org.w3c.dom.Element
                listOf(tag(e, "name"), tag(e, "url")).filter { it.isNotEmpty() }.joinToString(", ")
            }
            val parent = doc.getElementsByTagName("parent").item(0) as? org.w3c.dom.Element
            return named.ifEmpty { parent?.let { licencesOf(resolve("${tag(it, "groupId")}:${tag(it, "artifactId")}:${tag(it, "version")}@pom")) }.orEmpty() }
        }
        val lines = mutableListOf<String>()
        val notices = linkedMapOf<String, MutableList<String>>()   // each notice once, with the libraries that carry it
        for (m in modules) {
            val pom = resolve("${m.group}:${m.module}:${m.version}@pom")
            val named = licencesOf(pom)
            lines += "${m.group}:${m.module} ${m.version}: ${named.joinToString("; ").ifEmpty { "see https://mvnrepository.com/artifact/${m.group}/${m.module}" }}"
            // Play services and ML Kit put their own third-party notices inside the library.
            if (m.group.startsWith("com.google.android.gms") || m.group.startsWith("com.google.mlkit")) {
                val aar = resolve("${m.group}:${m.module}:${m.version}@aar") ?: continue
                ZipFile(aar).use { zip ->
                    zip.getEntry("third_party_licenses.txt")?.let { entry ->
                        val text = zip.getInputStream(entry).bufferedReader().readText().trim()
                        if (text.isNotEmpty()) notices.getOrPut(text) { mutableListOf() } += "${m.group}:${m.module}"
                    }
                }
            }
        }
        val rule = "=".repeat(100)
        val out = licencesDir.get().file("licences.txt").asFile
        out.parentFile.mkdirs()
        out.writeText(buildString {
            append("BeerMat ${android.defaultConfig.versionName}\n\nBeerMat is BeerMat's own software: https://beermatquiz.co.uk/terms. ")
            append("It is built with the libraries below, each under the licence named. Its font is Fredoka (SIL Open Font License, ")
            append("Fredoka-OFL.txt).\n\n$rule\nLibraries\n$rule\n\n")
            lines.forEach { append(it).append('\n') }
            notices.forEach { (text, libraries) -> append("\n$rule\nNotices in ${libraries.joinToString(", ")}\n$rule\n\n$text\n") }
            append("\n$rule\nApache License 2.0\n$rule\n\n").append(apache.readText())
        })
    }
}
android.sourceSets["main"].assets.srcDir(licencesDir)
tasks.named("preBuild") { dependsOn(writeLicences) }
