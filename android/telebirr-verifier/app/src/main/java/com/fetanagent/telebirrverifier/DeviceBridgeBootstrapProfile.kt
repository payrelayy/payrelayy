package com.fetanagent.telebirrverifier

import java.util.Base64

enum class VerifierRuntimeMode(val wireName: String) {
  INERT("inert"),
  PAIRING_ONLY("pairing_only"),
  EVIDENCE_ONLY("evidence_only");

  companion object {
    fun fromWire(value: String): VerifierRuntimeMode? = entries.find { it.wireName == value }
  }
}

/**
 * Public trust material authenticated by the APK signature. It contains no credential or private
 * key and cannot be changed through the UI. An operational release is useful only when both key
 * fingerprints match the independently provisioned bridge manifest.
 */
class DeviceBridgeBootstrapProfile(
  val runtimeMode: VerifierRuntimeMode,
  val serverSignerKeyId: String,
  serverSignerPublicKeySpkiDer: ByteArray,
  val serverSignerPublicKeySpkiSha256: String,
  val assignmentSignerKeyId: String,
  assignmentSignerPublicKeySpkiDer: ByteArray,
  val assignmentSignerPublicKeySpkiSha256: String,
) {
  private val serverSignerPublicKey = serverSignerPublicKeySpkiDer.copyOf()
  private val assignmentSignerPublicKey = assignmentSignerPublicKeySpkiDer.copyOf()

  init {
    require(runtimeMode != VerifierRuntimeMode.INERT)
    DeviceBridgeProtocol.requireOpaqueId(serverSignerKeyId, "serverSignerKeyId")
    DeviceBridgeProtocol.requireOpaqueId(assignmentSignerKeyId, "assignmentSignerKeyId")
    DeviceBridgeProtocol.requireSha256(
      serverSignerPublicKeySpkiSha256,
      "serverSignerPublicKeySpkiSha256",
    )
    DeviceBridgeProtocol.requireSha256(
      assignmentSignerPublicKeySpkiSha256,
      "assignmentSignerPublicKeySpkiSha256",
    )
    val canonicalServer = canonicalP256(serverSignerPublicKey)
    val canonicalAssignment = canonicalP256(assignmentSignerPublicKey)
    require(DeviceBridgeCanonical.sha256(canonicalServer) == serverSignerPublicKeySpkiSha256)
    require(
      DeviceBridgeCanonical.sha256(canonicalAssignment) ==
        assignmentSignerPublicKeySpkiSha256,
    )
    require(serverSignerKeyId != assignmentSignerKeyId)
    require(serverSignerPublicKeySpkiSha256 != assignmentSignerPublicKeySpkiSha256)
  }

  fun serverSignerPublicKeySpkiDer(): ByteArray = serverSignerPublicKey.copyOf()

  fun assignmentSignerPublicKeySpkiDer(): ByteArray = assignmentSignerPublicKey.copyOf()

  fun requireCertificateBinding(certificate: SignedDeviceBridgeEnrollmentCertificate) {
    require(certificate.signerKeyId == serverSignerKeyId)
    require(certificate.body.assignmentSignerKeyId == assignmentSignerKeyId)
    require(
      certificate.body.assignmentSignerPublicKeySpkiSha256 ==
        assignmentSignerPublicKeySpkiSha256,
    )
    require(DeviceBridgeVerifier.verifyCertificate(certificate, serverSignerPublicKey))
  }

  override fun toString(): String =
    "DeviceBridgeBootstrapProfile(mode=${runtimeMode.wireName},publicTrust=<redacted>)"

  companion object {
    fun fromBuildConfig(): DeviceBridgeBootstrapProfile? {
      if (!BuildConfig.VERIFIER_ENABLED) {
        require(BuildConfig.VERIFIER_RUNTIME_MODE == VerifierRuntimeMode.INERT.wireName)
        require(BuildConfig.SERVER_SIGNER_KEY_ID.isEmpty())
        require(BuildConfig.SERVER_SIGNER_PUBLIC_KEY_SPKI.isEmpty())
        require(BuildConfig.SERVER_SIGNER_PUBLIC_KEY_SPKI_SHA256.isEmpty())
        require(BuildConfig.ASSIGNMENT_SIGNER_KEY_ID.isEmpty())
        require(BuildConfig.ASSIGNMENT_SIGNER_PUBLIC_KEY_SPKI.isEmpty())
        require(BuildConfig.ASSIGNMENT_SIGNER_PUBLIC_KEY_SPKI_SHA256.isEmpty())
        return null
      }
      val mode = requireNotNull(VerifierRuntimeMode.fromWire(BuildConfig.VERIFIER_RUNTIME_MODE))
      require(mode != VerifierRuntimeMode.INERT)
      return DeviceBridgeBootstrapProfile(
        runtimeMode = mode,
        serverSignerKeyId = BuildConfig.SERVER_SIGNER_KEY_ID,
        serverSignerPublicKeySpkiDer =
          decodeCanonicalBase64Url(BuildConfig.SERVER_SIGNER_PUBLIC_KEY_SPKI),
        serverSignerPublicKeySpkiSha256 = BuildConfig.SERVER_SIGNER_PUBLIC_KEY_SPKI_SHA256,
        assignmentSignerKeyId = BuildConfig.ASSIGNMENT_SIGNER_KEY_ID,
        assignmentSignerPublicKeySpkiDer =
          decodeCanonicalBase64Url(BuildConfig.ASSIGNMENT_SIGNER_PUBLIC_KEY_SPKI),
        assignmentSignerPublicKeySpkiSha256 =
          BuildConfig.ASSIGNMENT_SIGNER_PUBLIC_KEY_SPKI_SHA256,
      )
    }

    private fun decodeCanonicalBase64Url(value: String): ByteArray {
      require(Regex("^[A-Za-z0-9_-]+$").matches(value))
      val decoded = Base64.getUrlDecoder().decode(value)
      require(Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == value)
      return decoded
    }

    private fun canonicalP256(value: ByteArray): ByteArray {
      val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(value)
      return DeviceBridgeCrypto.parseP256SpkiBase64Url(encoded)
    }
  }
}

