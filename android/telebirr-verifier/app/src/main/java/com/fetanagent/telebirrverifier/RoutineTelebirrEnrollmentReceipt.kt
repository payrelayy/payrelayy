package com.fetanagent.telebirrverifier

import java.nio.charset.StandardCharsets
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.time.Instant
import java.util.Base64
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.X509EncodedKeySpec

/** A signed acknowledgment of a routine enrollment, with no polling or money authority. */
internal data class RoutineEnrollmentReceiptBody(
  val contractVersion: Int = 1,
  val providerCode: String = "telebirr",
  val protocolMode: String = RoutineEnrollmentReceiptProtocol.MODE,
  val enrollmentId: String,
  val pairingEvidenceDigest: String,
  val deviceId: String,
  val keyId: String,
  val devicePublicKeySpkiSha256: String,
  val receiverRevisionId: String,
  val receiverVersion: Int,
  val receiverProfileDigest: String,
  val expectedReceiverNameDigest: String,
  val validFrom: String,
  val validUntil: String,
  val issuedAt: String,
  val assignmentPollingAllowed: Boolean = false,
  val financialActionAllowed: Boolean = false,
  val moneyMovementAllowed: Boolean = false,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    require(contractVersion == 1 && providerCode == "telebirr" && protocolMode == RoutineEnrollmentReceiptProtocol.MODE)
    require(p.UUID_V4.matches(enrollmentId) && p.DIGEST.matches(pairingEvidenceDigest))
    require(p.OPAQUE_ID.matches(deviceId) && p.OPAQUE_ID.matches(keyId))
    require(p.DIGEST.matches(devicePublicKeySpkiSha256))
    require(p.UUID_V4.matches(receiverRevisionId) && receiverVersion > 0)
    require(p.DIGEST.matches(receiverProfileDigest) && p.DIGEST.matches(expectedReceiverNameDigest))
    p.requireUtc(validFrom)
    p.requireUtc(validUntil)
    p.requireUtc(issuedAt)
    val from = Instant.parse(validFrom).toEpochMilli()
    val end = Instant.parse(validUntil).toEpochMilli()
    val issued = Instant.parse(issuedAt).toEpochMilli()
    require(end - from in 1..30L * 86_400_000L)
    require(issued >= from && issued < end)
    require(!assignmentPollingAllowed && !financialActionAllowed && !moneyMovementAllowed)
  }

  override fun toString(): String = "RoutineEnrollmentReceiptBody(<redacted>)"
}

internal data class RoutineSignedEnrollmentReceipt(
  val contractVersion: Int = 1,
  val providerCode: String = "telebirr",
  val protocolMode: String = RoutineEnrollmentReceiptProtocol.MODE,
  val transcriptVersion: String = RoutineEnrollmentReceiptProtocol.TRANSCRIPT,
  val bodyDigestAlgorithm: String = "sha256",
  val bodyDigest: String,
  val signatureAlgorithm: String = "ecdsa-p256-sha256",
  val signatureEncoding: String = "ieee-p1363-base64url",
  val signerKeyId: String,
  val body: RoutineEnrollmentReceiptBody,
  val signature: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    require(contractVersion == 1 && providerCode == "telebirr" && protocolMode == RoutineEnrollmentReceiptProtocol.MODE)
    require(transcriptVersion == RoutineEnrollmentReceiptProtocol.TRANSCRIPT)
    require(bodyDigestAlgorithm == "sha256" && p.DIGEST.matches(bodyDigest))
    require(signatureAlgorithm == "ecdsa-p256-sha256" && signatureEncoding == "ieee-p1363-base64url")
    require(p.OPAQUE_ID.matches(signerKeyId) && p.SIGNATURE.matches(signature))
    val decoded = Base64.getUrlDecoder().decode(signature)
    require(decoded.size == 64)
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == signature)
  }

  override fun toString(): String = "RoutineSignedEnrollmentReceipt(<redacted>)"
}

internal data class RoutineEnrollmentTrustedSigner(
  val signerKeyId: String,
  val publicKeySpki: String,
  val publicKeySpkiSha256: String,
  val validFrom: String,
  val validUntil: String,
  val state: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    require(p.OPAQUE_ID.matches(signerKeyId) && p.DIGEST.matches(publicKeySpkiSha256))
    p.requireUtc(validFrom)
    p.requireUtc(validUntil)
    require(Instant.parse(validUntil).isAfter(Instant.parse(validFrom)))
    require(state == "active" || state == "revoked")
    val spki = DeviceBridgeCrypto.parseP256SpkiBase64Url(publicKeySpki)
    require(RoutineLookupCanonicalTranscripts.sha256(spki) == publicKeySpkiSha256)
    val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki)) as ECPublicKey
    val expected = AlgorithmParameters.getInstance("EC").run {
      init(ECGenParameterSpec("secp256r1"))
      getParameterSpec(ECParameterSpec::class.java)
    }
    require(key.params.curve == expected.curve && key.params.generator == expected.generator)
    require(key.params.order == expected.order && key.params.cofactor == expected.cofactor)
  }

  override fun toString(): String = "RoutineEnrollmentTrustedSigner(<redacted>)"
}

internal data class RoutineEnrollmentExpectedBinding(
  val pairingEvidenceDigest: String,
  val deviceId: String,
  val keyId: String,
  val devicePublicKeySpkiSha256: String,
  val receiverRevisionId: String,
  val receiverVersion: Int,
  val receiverProfileDigest: String,
  val expectedReceiverNameDigest: String,
) {
  companion object {
    fun fromPairingProof(proof: RoutineSignedDevicePairingProof): RoutineEnrollmentExpectedBinding {
      require(proof.bodyDigest == RoutineDevicePairingCanonical.bodyDigest(proof.body))
      val body = proof.body
      return RoutineEnrollmentExpectedBinding(
        pairingEvidenceDigest = proof.bodyDigest,
        deviceId = body.deviceId,
        keyId = body.keyId,
        devicePublicKeySpkiSha256 = body.devicePublicKeySpkiSha256,
        receiverRevisionId = body.receiverRevisionId,
        receiverVersion = body.receiverVersion,
        receiverProfileDigest = body.receiverProfileDigest,
        expectedReceiverNameDigest = body.expectedReceiverNameDigest,
      )
    }
  }
}

internal object RoutineEnrollmentReceiptProtocol {
  const val MODE = "routine_enrollment_receipt_v1"
  const val TRANSCRIPT = "telebirr-routine-enrollment-receipt-transcript-v1"

  fun bodyBytes(body: RoutineEnrollmentReceiptBody): ByteArray =
    RoutineLookupCanonicalTranscripts.encode(
      "fetanagent:telebirr:routine:enrollment-receipt-body:v1",
      listOf(
        "contractVersion" to body.contractVersion,
        "providerCode" to body.providerCode,
        "protocolMode" to body.protocolMode,
        "enrollmentId" to body.enrollmentId,
        "pairingEvidenceDigest" to body.pairingEvidenceDigest,
        "deviceId" to body.deviceId,
        "keyId" to body.keyId,
        "devicePublicKeySpkiSha256" to body.devicePublicKeySpkiSha256,
        "receiverRevisionId" to body.receiverRevisionId,
        "receiverVersion" to body.receiverVersion,
        "receiverProfileDigest" to body.receiverProfileDigest,
        "expectedReceiverNameDigest" to body.expectedReceiverNameDigest,
        "validFrom" to body.validFrom,
        "validUntil" to body.validUntil,
        "issuedAt" to body.issuedAt,
        "assignmentPollingAllowed" to body.assignmentPollingAllowed,
        "financialActionAllowed" to body.financialActionAllowed,
        "moneyMovementAllowed" to body.moneyMovementAllowed,
      ),
    )

  fun bodyDigest(body: RoutineEnrollmentReceiptBody): String =
    RoutineLookupCanonicalTranscripts.sha256(bodyBytes(body))

  fun signatureBytes(body: RoutineEnrollmentReceiptBody, signerKeyId: String): ByteArray {
    require(RoutineTelebirrLookupProtocol.OPAQUE_ID.matches(signerKeyId))
    return RoutineLookupCanonicalTranscripts.encode(
      TRANSCRIPT,
      listOf("signerKeyId" to signerKeyId, "bodyDigest" to bodyDigest(body)),
    )
  }

  /** Both signer and expected binding must be supplied from outside the untrusted receipt. */
  fun verify(
    receipt: RoutineSignedEnrollmentReceipt,
    signer: RoutineEnrollmentTrustedSigner,
    expected: RoutineEnrollmentExpectedBinding,
    localPublicMaterial: IdentityPublicMaterial,
    assessedAt: String,
  ): Boolean {
    return runCatching {
    RoutineTelebirrLookupProtocol.requireUtc(assessedAt)
    val body = receipt.body
    if (signer.state != "active" || signer.signerKeyId != receipt.signerKeyId ||
      assessedAt < signer.validFrom || assessedAt >= signer.validUntil ||
      body.issuedAt < signer.validFrom || body.issuedAt >= signer.validUntil ||
      assessedAt < body.validFrom || assessedAt >= body.validUntil ||
      body.pairingEvidenceDigest != expected.pairingEvidenceDigest ||
      body.deviceId != expected.deviceId || body.keyId != expected.keyId ||
      body.devicePublicKeySpkiSha256 != expected.devicePublicKeySpkiSha256 ||
      body.receiverRevisionId != expected.receiverRevisionId ||
      body.receiverVersion != expected.receiverVersion ||
      body.receiverProfileDigest != expected.receiverProfileDigest ||
      body.expectedReceiverNameDigest != expected.expectedReceiverNameDigest ||
      localPublicMaterial.keyId != body.keyId ||
      localPublicMaterial.publicKeySpkiSha256 != body.devicePublicKeySpkiSha256 ||
      bodyDigest(body) != receipt.bodyDigest
    ) return false
    val localSpki = DeviceBridgeCrypto.parseP256SpkiBase64Url(localPublicMaterial.publicKeySpkiBase64Url)
    if (RoutineLookupCanonicalTranscripts.sha256(localSpki) != body.devicePublicKeySpkiSha256) return false
    DeviceBridgeCrypto.verifyP1363(
      Base64.getUrlDecoder().decode(signer.publicKeySpki),
      signatureBytes(body, receipt.signerKeyId),
      receipt.signature,
    )
    }.getOrDefault(false)
  }

  /** Recovery for a phone paired before pending-proof storage existed. No action authority follows. */
  fun verifyExistingLocalKey(
    receipt: RoutineSignedEnrollmentReceipt,
    signer: RoutineEnrollmentTrustedSigner,
    localPublicMaterial: IdentityPublicMaterial,
    assessedAt: String,
  ): Boolean = runCatching {
    RoutineTelebirrLookupProtocol.requireUtc(assessedAt)
    val body = receipt.body
    if (signer.state != "active" || signer.signerKeyId != receipt.signerKeyId ||
      assessedAt < signer.validFrom || assessedAt >= signer.validUntil ||
      body.issuedAt < signer.validFrom || body.issuedAt >= signer.validUntil ||
      assessedAt < body.validFrom || assessedAt >= body.validUntil ||
      body.keyId != localPublicMaterial.keyId ||
      body.devicePublicKeySpkiSha256 != localPublicMaterial.publicKeySpkiSha256 ||
      bodyDigest(body) != receipt.bodyDigest) return false
    val localSpki = DeviceBridgeCrypto.parseP256SpkiBase64Url(
      localPublicMaterial.publicKeySpkiBase64Url)
    if (RoutineLookupCanonicalTranscripts.sha256(localSpki) != body.devicePublicKeySpkiSha256) return false
    DeviceBridgeCrypto.verifyP1363(
      Base64.getUrlDecoder().decode(signer.publicKeySpki),
      signatureBytes(body, receipt.signerKeyId), receipt.signature,
    )
  }.getOrDefault(false)
}

/** Strict, duplicate-key-rejecting receipt wire codec; it does not authenticate a receipt. */
internal object RoutineEnrollmentReceiptJsonCodec {
  private const val PACKAGE_PREFIX = "fetanagent-routine-enrollment-receipt-v1."
  private val envelopeKeys = setOf("contractVersion", "providerCode", "protocolMode",
    "transcriptVersion", "bodyDigestAlgorithm", "bodyDigest", "signatureAlgorithm",
    "signatureEncoding", "signerKeyId", "body", "signature")
  private val bodyKeys = setOf("contractVersion", "providerCode", "protocolMode",
    "enrollmentId", "pairingEvidenceDigest", "deviceId", "keyId",
    "devicePublicKeySpkiSha256", "receiverRevisionId", "receiverVersion",
    "receiverProfileDigest", "expectedReceiverNameDigest", "validFrom", "validUntil",
    "issuedAt", "assignmentPollingAllowed", "financialActionAllowed", "moneyMovementAllowed")

  fun decodePackage(value: String): RoutineSignedEnrollmentReceipt? = runCatching {
    require(value.length in (PACKAGE_PREFIX.length + 1)..4_096 && value.startsWith(PACKAGE_PREFIX))
    val encoded = value.removePrefix(PACKAGE_PREFIX)
    require(Regex("^[A-Za-z0-9_-]+$").matches(encoded))
    val bytes = Base64.getUrlDecoder().decode(encoded)
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == encoded)
    decode(bytes)
  }.getOrNull()

  fun decode(bytes: ByteArray): RoutineSignedEnrollmentReceipt? = runCatching {
    require(bytes.size in 1..4_096)
    val envelope = StrictJson.parse(bytes).requireObject(envelopeKeys)
    val body = envelope.value("body").requireObject(bodyKeys)
    RoutineSignedEnrollmentReceipt(
      contractVersion = envelope.int("contractVersion"),
      providerCode = envelope.string("providerCode"),
      protocolMode = envelope.string("protocolMode"),
      transcriptVersion = envelope.string("transcriptVersion"),
      bodyDigestAlgorithm = envelope.string("bodyDigestAlgorithm"),
      bodyDigest = envelope.string("bodyDigest"),
      signatureAlgorithm = envelope.string("signatureAlgorithm"),
      signatureEncoding = envelope.string("signatureEncoding"),
      signerKeyId = envelope.string("signerKeyId"),
      body = RoutineEnrollmentReceiptBody(
        contractVersion = body.int("contractVersion"),
        providerCode = body.string("providerCode"),
        protocolMode = body.string("protocolMode"),
        enrollmentId = body.string("enrollmentId"),
        pairingEvidenceDigest = body.string("pairingEvidenceDigest"),
        deviceId = body.string("deviceId"),
        keyId = body.string("keyId"),
        devicePublicKeySpkiSha256 = body.string("devicePublicKeySpkiSha256"),
        receiverRevisionId = body.string("receiverRevisionId"),
        receiverVersion = body.int("receiverVersion"),
        receiverProfileDigest = body.string("receiverProfileDigest"),
        expectedReceiverNameDigest = body.string("expectedReceiverNameDigest"),
        validFrom = body.string("validFrom"),
        validUntil = body.string("validUntil"),
        issuedAt = body.string("issuedAt"),
        assignmentPollingAllowed = body.boolean("assignmentPollingAllowed"),
        financialActionAllowed = body.boolean("financialActionAllowed"),
        moneyMovementAllowed = body.boolean("moneyMovementAllowed"),
      ),
      signature = envelope.string("signature"),
    )
  }.getOrNull()

  fun encode(receipt: RoutineSignedEnrollmentReceipt): ByteArray {
    val body = receipt.body
    val bytes = StrictJson.encode(obj(
      "contractVersion" to number(receipt.contractVersion.toLong()),
      "providerCode" to text(receipt.providerCode),
      "protocolMode" to text(receipt.protocolMode),
      "transcriptVersion" to text(receipt.transcriptVersion),
      "bodyDigestAlgorithm" to text(receipt.bodyDigestAlgorithm),
      "bodyDigest" to text(receipt.bodyDigest),
      "signatureAlgorithm" to text(receipt.signatureAlgorithm),
      "signatureEncoding" to text(receipt.signatureEncoding),
      "signerKeyId" to text(receipt.signerKeyId),
      "body" to obj(
        "contractVersion" to number(body.contractVersion.toLong()),
        "providerCode" to text(body.providerCode),
        "protocolMode" to text(body.protocolMode),
        "enrollmentId" to text(body.enrollmentId),
        "pairingEvidenceDigest" to text(body.pairingEvidenceDigest),
        "deviceId" to text(body.deviceId),
        "keyId" to text(body.keyId),
        "devicePublicKeySpkiSha256" to text(body.devicePublicKeySpkiSha256),
        "receiverRevisionId" to text(body.receiverRevisionId),
        "receiverVersion" to number(body.receiverVersion.toLong()),
        "receiverProfileDigest" to text(body.receiverProfileDigest),
        "expectedReceiverNameDigest" to text(body.expectedReceiverNameDigest),
        "validFrom" to text(body.validFrom),
        "validUntil" to text(body.validUntil),
        "issuedAt" to text(body.issuedAt),
        "assignmentPollingAllowed" to bool(body.assignmentPollingAllowed),
        "financialActionAllowed" to bool(body.financialActionAllowed),
        "moneyMovementAllowed" to bool(body.moneyMovementAllowed),
      ),
      "signature" to text(receipt.signature),
    )).toByteArray(StandardCharsets.UTF_8)
    require(bytes.size in 1..4_096)
    return bytes
  }
}
