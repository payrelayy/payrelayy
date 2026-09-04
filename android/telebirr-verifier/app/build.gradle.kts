plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.fetanagent.telebirrverifier"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.fetanagent.telebirrverifier"
    minSdk = 28
    targetSdk = 35
    versionCode = 4
    versionName = "0.4.0-foreground-inert"

    buildConfigField("boolean", "VERIFIER_ENABLED", "false")
    testInstrumentationRunner = "android.test.InstrumentationTestRunner"
  }

  buildTypes {
    debug {
      isMinifyEnabled = false
    }
    release {
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  buildFeatures {
    buildConfig = true
  }

  testOptions {
    unitTests.isReturnDefaultValues = true
  }
}

val gradleLibDir = requireNotNull(gradle.gradleHomeDir).resolve("lib")

dependencies {
  implementation("com.google.code.gson:gson:2.14.0")

  // Gradle 8.11.1 already ships these exact test-runner jars, so offline validation needs no download.
  testImplementation(files(gradleLibDir.resolve("junit-4.13.2.jar")))
  testImplementation(files(gradleLibDir.resolve("hamcrest-core-1.3.jar")))
}
