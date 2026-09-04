import java.io.File
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec
import java.security.cert.X509Certificate
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.util.Base64

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

data class OperationalVerifierTrust(
  val runtimeMode: String,
  val serverSignerKeyId: String,
  val serverSignerPublicKeySpki: String,
  val serverSignerPublicKeySpkiSha256: String,
  val assignmentSignerKeyId: String,
  val assignmentSignerPublicKeySpki: String,
  val assignmentSignerPublicKeySpkiSha256: String,
)

data class OperationalVerifierSigning(
  val keyAlias: String,
  val keyPassword: String,
  val storeFile: File,
  val storePassword: String,
)

fun quotedBuildConfig(value: String): String =
  "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

fun readP256PublicKey(propertyName: String): Pair<String, String> {
  val configuredPath =
    providers.gradleProperty(propertyName).orNull
      ?: error("Operational verifier builds require -P$propertyName=<P-256-SPKI-DER-file>.")
  val path = file(configuredPath).toPath().toAbsolutePath().normalize()
  require(Files.isRegularFile(path) && !Files.isSymbolicLink(path)) {
    "$propertyName must identify one regular, non-symlink public-key file."
  }
  val der = Files.readAllBytes(path)
  require(der.size in 1..512) { "$propertyName is not a bounded public key." }
  val key =
    KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(der)) as? ECPublicKey
      ?: error("$propertyName is not an EC public key.")
  require(key.params.curve.field.fieldSize == 256 && key.encoded.contentEquals(der)) {
    "$propertyName must be one canonical P-256 SPKI DER public key."
  }
  val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(der)
  val digest =
    MessageDigest.getInstance("SHA-256")
      .digest(der)
      .joinToString(separator = "") { byte -> "%02x".format(byte) }
  return encoded to "sha256:$digest"
}

val requestedRuntimeMode =
  providers.gradleProperty("fetanagentVerifierRuntimeMode").orNull ?: "inert"
require(requestedRuntimeMode in setOf("inert", "pairing_only", "evidence_only")) {
  "fetanagentVerifierRuntimeMode must be inert, pairing_only, or evidence_only."
}

val operationalTrust =
  if (requestedRuntimeMode == "inert") {
    null
  } else {
    fun keyId(propertyName: String): String =
      requireNotNull(providers.gradleProperty(propertyName).orNull) {
          "Operational verifier builds require -P$propertyName=<opaque-key-id>."
        }
        .also { value ->
          require(Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$").matches(value)) {
            "$propertyName is not a bounded opaque key identifier."
          }
        }
    val serverKey = readP256PublicKey("fetanagentVerifierServerSignerSpkiFile")
    val assignmentKey = readP256PublicKey("fetanagentVerifierAssignmentSignerSpkiFile")
    require(serverKey.second != assignmentKey.second) {
      "The bridge server signer and assignment signer must be independent keys."
    }
    OperationalVerifierTrust(
      runtimeMode = requestedRuntimeMode,
      serverSignerKeyId = keyId("fetanagentVerifierServerSignerKeyId"),
      serverSignerPublicKeySpki = serverKey.first,
      serverSignerPublicKeySpkiSha256 = serverKey.second,
      assignmentSignerKeyId = keyId("fetanagentVerifierAssignmentSignerKeyId"),
      assignmentSignerPublicKeySpki = assignmentKey.first,
      assignmentSignerPublicKeySpkiSha256 = assignmentKey.second,
    )
  }

val operationalSigning =
  if (operationalTrust == null) {
    null
  } else {
    val configuredPath =
      providers.gradleProperty("fetanagentVerifierSigningStoreFile").orNull
        ?: error(
          "Operational verifier builds require " +
            "-PfetanagentVerifierSigningStoreFile=<PKCS12-file>.",
        )
    val keyAlias =
      providers.gradleProperty("fetanagentVerifierSigningKeyAlias").orNull
        ?: error(
          "Operational verifier builds require " +
            "-PfetanagentVerifierSigningKeyAlias=<key-alias>.",
        )
    val expectedCertificateDigest =
      providers.gradleProperty("fetanagentVerifierSigningCertSha256").orNull
        ?: error(
          "Operational verifier builds require " +
            "-PfetanagentVerifierSigningCertSha256=sha256:<hex>.",
        )
    require(Regex("^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$").matches(keyAlias)) {
      "fetanagentVerifierSigningKeyAlias is not a bounded alias."
    }
    require(Regex("^sha256:[0-9a-f]{64}$").matches(expectedCertificateDigest)) {
      "fetanagentVerifierSigningCertSha256 is not a SHA-256 identifier."
    }

    fun signingSecret(name: String): String =
      requireNotNull(providers.environmentVariable(name).orNull) {
        "Operational verifier signing secret $name is unavailable."
      }.also { value ->
        require(value.length in 32..256 && !value.any(Char::isWhitespace)) {
          "Operational verifier signing secret $name is malformed."
        }
      }

    val storePassword = signingSecret("FETANAGENT_ANDROID_SIGNING_STORE_PASSWORD")
    val keyPassword = signingSecret("FETANAGENT_ANDROID_SIGNING_KEY_PASSWORD")
    val path = file(configuredPath).toPath().toAbsolutePath().normalize()
    require(Files.isRegularFile(path) && !Files.isSymbolicLink(path)) {
      "fetanagentVerifierSigningStoreFile must identify one regular, non-symlink file."
    }
    require(Files.size(path) in 1..65_536) {
      "fetanagentVerifierSigningStoreFile is not a bounded PKCS12 store."
    }

    val storePasswordCharacters = storePassword.toCharArray()
    val keyPasswordCharacters = keyPassword.toCharArray()
    try {
      val keyStore = KeyStore.getInstance("PKCS12")
      Files.newInputStream(path, StandardOpenOption.READ).use { input ->
        keyStore.load(input, storePasswordCharacters)
      }
      val aliases = keyStore.aliases().toList()
      require(aliases == listOf(keyAlias) && keyStore.isKeyEntry(keyAlias)) {
        "The operational signing store must contain only the configured key entry."
      }
      val certificate = keyStore.getCertificate(keyAlias) as? X509Certificate
        ?: error("The operational signing entry has no X.509 certificate.")
      certificate.checkValidity()
      val privateKey = keyStore.getKey(keyAlias, keyPasswordCharacters) as? PrivateKey
        ?: error("The operational signing entry has no private key.")
      require(
        certificate.publicKey.algorithm == "RSA" &&
          privateKey.algorithm == certificate.publicKey.algorithm,
      ) {
        "The operational signing entry must contain one matching RSA key pair."
      }
      val signingProbe = "fetanagent-android-signing-key-match-v1".toByteArray(Charsets.UTF_8)
      val signer = Signature.getInstance("SHA256withRSA")
      signer.initSign(privateKey)
      signer.update(signingProbe)
      val probeSignature = signer.sign()
      try {
        val verifier = Signature.getInstance("SHA256withRSA")
        verifier.initVerify(certificate.publicKey)
        verifier.update(signingProbe)
        require(verifier.verify(probeSignature)) {
          "The operational signing certificate does not match its private key."
        }
      } finally {
        probeSignature.fill(0)
      }
      val actualCertificateDigest =
        "sha256:" +
          MessageDigest.getInstance("SHA-256")
            .digest(certificate.encoded)
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
      require(actualCertificateDigest == expectedCertificateDigest) {
        "The operational signing certificate does not match its reviewed fingerprint."
      }
    } finally {
      storePasswordCharacters.fill('\u0000')
      keyPasswordCharacters.fill('\u0000')
    }

    OperationalVerifierSigning(
      keyAlias = keyAlias,
      keyPassword = keyPassword,
      storeFile = path.toFile(),
      storePassword = storePassword,
    )
  }

val verifierVersionName =
  when (requestedRuntimeMode) {
    "pairing_only" -> "0.5.0-secure-pairing"
    "evidence_only" -> "0.5.0-evidence-only"
    else -> "0.5.0-secure-provisioning-inert"
  }

android {
  namespace = "com.fetanagent.telebirrverifier"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.fetanagent.telebirrverifier"
    minSdk = 28
    targetSdk = 35
    versionCode = 5
    versionName = verifierVersionName

    buildConfigField("boolean", "VERIFIER_ENABLED", "false")
    buildConfigField("String", "VERIFIER_RUNTIME_MODE", quotedBuildConfig("inert"))
    buildConfigField("String", "SERVER_SIGNER_KEY_ID", quotedBuildConfig(""))
    buildConfigField("String", "SERVER_SIGNER_PUBLIC_KEY_SPKI", quotedBuildConfig(""))
    buildConfigField("String", "SERVER_SIGNER_PUBLIC_KEY_SPKI_SHA256", quotedBuildConfig(""))
    buildConfigField("String", "ASSIGNMENT_SIGNER_KEY_ID", quotedBuildConfig(""))
    buildConfigField("String", "ASSIGNMENT_SIGNER_PUBLIC_KEY_SPKI", quotedBuildConfig(""))
    buildConfigField("String", "ASSIGNMENT_SIGNER_PUBLIC_KEY_SPKI_SHA256", quotedBuildConfig(""))
    testInstrumentationRunner = "android.test.InstrumentationTestRunner"
  }

  signingConfigs {
    operationalSigning?.let { signing ->
      create("operationalRelease") {
        storeFile = signing.storeFile
        storePassword = signing.storePassword
        keyAlias = signing.keyAlias
        keyPassword = signing.keyPassword
        storeType = "PKCS12"
        enableV1Signing = false
        enableV2Signing = true
      }
    }
  }

  buildTypes {
    debug {
      isMinifyEnabled = false
    }
    release {
      isMinifyEnabled = true
      operationalSigning?.let {
        signingConfig = signingConfigs.getByName("operationalRelease")
      }
      operationalTrust?.let { trust ->
        buildConfigField("boolean", "VERIFIER_ENABLED", "true")
        buildConfigField("String", "VERIFIER_RUNTIME_MODE", quotedBuildConfig(trust.runtimeMode))
        buildConfigField("String", "SERVER_SIGNER_KEY_ID", quotedBuildConfig(trust.serverSignerKeyId))
        buildConfigField(
          "String",
          "SERVER_SIGNER_PUBLIC_KEY_SPKI",
          quotedBuildConfig(trust.serverSignerPublicKeySpki),
        )
        buildConfigField(
          "String",
          "SERVER_SIGNER_PUBLIC_KEY_SPKI_SHA256",
          quotedBuildConfig(trust.serverSignerPublicKeySpkiSha256),
        )
        buildConfigField(
          "String",
          "ASSIGNMENT_SIGNER_KEY_ID",
          quotedBuildConfig(trust.assignmentSignerKeyId),
        )
        buildConfigField(
          "String",
          "ASSIGNMENT_SIGNER_PUBLIC_KEY_SPKI",
          quotedBuildConfig(trust.assignmentSignerPublicKeySpki),
        )
        buildConfigField(
          "String",
          "ASSIGNMENT_SIGNER_PUBLIC_KEY_SPKI_SHA256",
          quotedBuildConfig(trust.assignmentSignerPublicKeySpkiSha256),
        )
      }
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
