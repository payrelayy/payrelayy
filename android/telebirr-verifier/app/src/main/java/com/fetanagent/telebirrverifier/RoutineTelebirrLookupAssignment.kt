package com.fetanagent.telebirrverifier

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.charset.StandardCharsets
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.Base64

/** Dormant, evidence-only contract. It grants no provider, database, claim, or financial access. */
internal object RoutineTelebirrLookupProtocol {
  const val CONTRACT_VERSION = 1
  const val PROVIDER_CODE = "telebirr"
  const val PROTOCOL_MODE = "routine_signed_observation_v1"
  const val TRANSCRIPT_VERSION = "telebirr-routine-lookup-assignment-transcript-v1"
  const val SOURCE_PROFILE = "telebirr_official_receipt_v1"
  const val DIGEST_ALGORITHM = "sha256"
  const val SIGNATURE_ALGORITHM = "ecdsa-p256-sha256"
  const val SIGNATURE_ENCODING = "ieee-p1363-base64url"

  val UUID_V4 = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
  val OPAQUE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")
  val DIGEST = Regex("^sha256:[0-9a-f]{64}$")
  val FINGERPRINT = Regex("^[0-9a-f]{64}$")
  val REFERENCE = Regex("^[A-Z0-9]{8,32}$")
  val SIGNATURE = Regex("^[A-Za-z0-9_-]{86}$")
  private val UTC = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")
  private val utcFormatter = DateTimeFormatterBuilder().appendInstant(3).toFormatter()

  fun requireHeader(contractVersion: Int, providerCode: String, protocolMode: String) {
    require(contractVersion == CONTRACT_VERSION)
    require(providerCode == PROVIDER_CODE)
    require(protocolMode == PROTOCOL_MODE)
  }

  fun requireUtc(value: String) {
    require(UTC.matches(value))
    require(utcFormatter.format(Instant.parse(value)) == value)
  }
}

internal data class RoutineLookupAssignmentBody(
  val contractVersion: Int = RoutineTelebirrLookupProtocol.CONTRACT_VERSION,
  val providerCode: String = RoutineTelebirrLookupProtocol.PROVIDER_CODE,
  val protocolMode: String = RoutineTelebirrLookupProtocol.PROTOCOL_MODE,
  val candidateId: String,
  val rawReference: String,
  val referenceFingerprint: String,
  val referenceKeyVersion: Int,
  val referenceProfileVersion: Int,
  val submittedAt: String,
  val receiverRevisionId: String,
  val receiverVersion: Int,
  val receiverProfileDigest: String,
  val receiverNameNormalizerVersion: String,
  val expectedReceiverNameNormalized: String,
  val expectedReceiverNameDigest: String,
  val deviceId: String,
  val keyId: String,
  val challengeId: String,
  val challengeDigest: String,
  val sourceProfile: String,
  val issuedAt: String,
  val expiresAt: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    p.requireHeader(contractVersion, providerCode, protocolMode)
    require(p.UUID_V4.matches(candidateId))
    require(p.REFERENCE.matches(rawReference))
    require(p.FINGERPRINT.matches(referenceFingerprint))
    require(referenceKeyVersion == 2 && referenceProfileVersion == 2)
    p.requireUtc(submittedAt)
    require(p.UUID_V4.matches(receiverRevisionId))
    require(receiverVersion > 0)
    require(p.DIGEST.matches(receiverProfileDigest))
    require(receiverNameNormalizerVersion == RoutineTelebirrReceiverName.NORMALIZER_VERSION)
    require(
      LivePilotNameNormalizer.normalize(expectedReceiverNameNormalized) ==
        expectedReceiverNameNormalized
    )
    require(
      RoutineTelebirrReceiverName.digest(expectedReceiverNameNormalized) ==
        expectedReceiverNameDigest
    )
    require(p.OPAQUE_ID.matches(deviceId) && p.OPAQUE_ID.matches(keyId))
    require(p.UUID_V4.matches(challengeId) && p.DIGEST.matches(challengeDigest))
    require(sourceProfile == p.SOURCE_PROFILE)
    p.requireUtc(issuedAt)
    p.requireUtc(expiresAt)
  }

  override fun toString(): String = "RoutineLookupAssignmentBody(<redacted>)"
}

internal data class RoutineSignedLookupAssignment(
  val contractVersion: Int = RoutineTelebirrLookupProtocol.CONTRACT_VERSION,
  val providerCode: String = RoutineTelebirrLookupProtocol.PROVIDER_CODE,
  val protocolMode: String = RoutineTelebirrLookupProtocol.PROTOCOL_MODE,
  val transcriptVersion: String = RoutineTelebirrLookupProtocol.TRANSCRIPT_VERSION,
  val bodyDigestAlgorithm: String = RoutineTelebirrLookupProtocol.DIGEST_ALGORITHM,
  val bodyDigest: String,
  val signatureAlgorithm: String = RoutineTelebirrLookupProtocol.SIGNATURE_ALGORITHM,
  val signatureEncoding: String = RoutineTelebirrLookupProtocol.SIGNATURE_ENCODING,
  val signerKeyId: String,
  val body: RoutineLookupAssignmentBody,
  val signature: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    p.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == p.TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == p.DIGEST_ALGORITHM && p.DIGEST.matches(bodyDigest))
    require(signatureAlgorithm == p.SIGNATURE_ALGORITHM)
    require(signatureEncoding == p.SIGNATURE_ENCODING)
    require(p.OPAQUE_ID.matches(signerKeyId))
    require(p.SIGNATURE.matches(signature))
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(Base64.getUrlDecoder().decode(signature)) == signature)
  }

  override fun toString(): String = "RoutineSignedLookupAssignment(<redacted>)"
}

internal data class RoutineLookupTrustedSigner(
  val contractVersion: Int = RoutineTelebirrLookupProtocol.CONTRACT_VERSION,
  val providerCode: String = RoutineTelebirrLookupProtocol.PROVIDER_CODE,
  val protocolMode: String = RoutineTelebirrLookupProtocol.PROTOCOL_MODE,
  val signerKeyId: String,
  val publicKeySpkiSha256: String,
  val state: String,
  val validFrom: String,
  val validUntil: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    p.requireHeader(contractVersion, providerCode, protocolMode)
    require(p.OPAQUE_ID.matches(signerKeyId) && p.DIGEST.matches(publicKeySpkiSha256))
    require(state == "active" || state == "revoked")
    p.requireUtc(validFrom)
    p.requireUtc(validUntil)
  }

  override fun toString(): String = "RoutineLookupTrustedSigner(<redacted>)"
}

internal data class RoutineLookupDeviceEnrollment(
  val contractVersion: Int = RoutineTelebirrLookupProtocol.CONTRACT_VERSION,
  val providerCode: String = RoutineTelebirrLookupProtocol.PROVIDER_CODE,
  val protocolMode: String = RoutineTelebirrLookupProtocol.PROTOCOL_MODE,
  val deviceId: String,
  val keyId: String,
  val publicKeySpkiSha256: String,
  val state: String,
  val validFrom: String,
  val validUntil: String,
  val receiverRevisionId: String,
  val receiverVersion: Int,
  val receiverProfileDigest: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    p.requireHeader(contractVersion, providerCode, protocolMode)
    require(p.OPAQUE_ID.matches(deviceId) && p.OPAQUE_ID.matches(keyId))
    require(p.DIGEST.matches(publicKeySpkiSha256))
    require(state == "active" || state == "revoked")
    p.requireUtc(validFrom)
    p.requireUtc(validUntil)
    require(p.UUID_V4.matches(receiverRevisionId) && receiverVersion > 0)
    require(p.DIGEST.matches(receiverProfileDigest))
  }

  override fun toString(): String = "RoutineLookupDeviceEnrollment(<redacted>)"
}

/** Exactly the TypeScript routine-assignment field order and typed scalar encoding. */
internal object RoutineLookupCanonicalTranscripts {
  fun bodyBytes(body: RoutineLookupAssignmentBody): ByteArray =
    encode(
      "fetanagent:telebirr:routine:lookup-assignment-body:v1",
      listOf(
        "contractVersion" to body.contractVersion,
        "providerCode" to body.providerCode,
        "protocolMode" to body.protocolMode,
        "candidateId" to body.candidateId,
        "rawReference" to body.rawReference,
        "referenceFingerprint" to body.referenceFingerprint,
        "referenceKeyVersion" to body.referenceKeyVersion,
        "referenceProfileVersion" to body.referenceProfileVersion,
        "submittedAt" to body.submittedAt,
        "receiverRevisionId" to body.receiverRevisionId,
        "receiverVersion" to body.receiverVersion,
        "receiverProfileDigest" to body.receiverProfileDigest,
        "receiverNameNormalizerVersion" to body.receiverNameNormalizerVersion,
        "expectedReceiverNameNormalized" to body.expectedReceiverNameNormalized,
        "expectedReceiverNameDigest" to body.expectedReceiverNameDigest,
        "deviceId" to body.deviceId,
        "keyId" to body.keyId,
        "challengeId" to body.challengeId,
        "challengeDigest" to body.challengeDigest,
        "sourceProfile" to body.sourceProfile,
        "issuedAt" to body.issuedAt,
        "expiresAt" to body.expiresAt,
      ),
    )

  fun bodyDigest(body: RoutineLookupAssignmentBody): String = sha256(bodyBytes(body))

  fun signatureBytes(body: RoutineLookupAssignmentBody): ByteArray =
    encode(
      RoutineTelebirrLookupProtocol.TRANSCRIPT_VERSION,
      listOf("bodyDigest" to bodyDigest(body)),
    )

  fun sha256(bytes: ByteArray): String =
    "sha256:" +
      MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString(separator = "") { byte -> "%02x".format(byte) }

  fun encode(domain: String, fields: List<Pair<String, Any>>): ByteArray {
    val values = mutableListOf(domain, fields.size.toString())
    for ((name, value) in fields) {
      values += name
      values +=
        when (value) {
          is String -> "string:$value"
          is Int -> "number:$value"
          is Boolean -> "boolean:$value"
          else -> error("Unsupported routine transcript scalar")
        }
    }
    return ByteArrayOutputStream().use { buffer ->
      DataOutputStream(buffer).use { output ->
        values.forEach { value ->
          val bytes = value.toByteArray(StandardCharsets.UTF_8)
          output.writeInt(bytes.size)
          output.write(bytes)
        }
      }
      buffer.toByteArray()
    }
  }
}

internal class AuthenticatedRoutineLookupAssignment internal constructor(
  internal val body: RoutineLookupAssignmentBody,
) {
  fun receiptExpectation(): RoutineReceiptLookupExpectation =
    RoutineReceiptLookupExpectation(
      candidateId = body.candidateId,
      rawReference = body.rawReference,
      referenceFingerprint = body.referenceFingerprint,
      expectedReceiverNameNormalized = body.expectedReceiverNameNormalized,
      expectedReceiverNameDigest = body.expectedReceiverNameDigest,
      receiverRevisionId = body.receiverRevisionId,
      receiverVersion = body.receiverVersion,
    )

  override fun toString(): String = "AuthenticatedRoutineLookupAssignment(<redacted>)"
}

internal data class RoutineLookupAssignmentAssessment(
  val disposition: String,
  val reasonCode: String,
  val authenticatedAssignment: AuthenticatedRoutineLookupAssignment?,
) {
  val advisoryOnly: Boolean = true
  val candidateDatabaseBindingPerformed: Boolean = false
  val sourceAuthenticationPerformed: Boolean = false
  val databaseWriteAllowed: Boolean = false
  val claimAllowed: Boolean = false
  val settlementAllowed: Boolean = false
  val enqueueAllowed: Boolean = false
  val executionAllowed: Boolean = false
  val financialActionAllowed: Boolean = false

  init {
    require(disposition == "would_open_assignment" || disposition == "would_review")
    require((disposition == "would_open_assignment") == (authenticatedAssignment != null))
  }

  override fun toString(): String =
    "RoutineLookupAssignmentAssessment(disposition=$disposition,reasonCode=$reasonCode)"
}

/** Signature and local device binding only; no candidate DB or TeleBirr authentication. */
internal object RoutineLookupAssignmentVerifier {
  fun verify(
    signer: RoutineLookupTrustedSigner,
    enrollment: RoutineLookupDeviceEnrollment,
    signedAssignment: RoutineSignedLookupAssignment,
    signerPublicSpkiDer: ByteArray,
    localDevicePublicMaterial: IdentityPublicMaterial,
    assessedAt: String,
  ): RoutineLookupAssignmentAssessment {
    return runCatching {
        val p = RoutineTelebirrLookupProtocol
        p.requireUtc(assessedAt)
        val body = signedAssignment.body
        if (
          signer.state != "active" ||
            assessedAt < signer.validFrom ||
            assessedAt >= signer.validUntil ||
            body.issuedAt < signer.validFrom ||
            body.expiresAt > signer.validUntil
        ) return review("signer_revoked_or_expired")
        val signerKey = parseP256Spki(signerPublicSpkiDer)
          ?: return review("signer_key_mismatch")
        if (RoutineLookupCanonicalTranscripts.sha256(signerPublicSpkiDer) != signer.publicKeySpkiSha256) {
          return review("signer_key_mismatch")
        }
        val localSpki = Base64.getUrlDecoder().decode(localDevicePublicMaterial.publicKeySpkiBase64Url)
        if (
          localDevicePublicMaterial.keyId != enrollment.keyId ||
            parseP256Spki(localSpki) == null ||
            RoutineLookupCanonicalTranscripts.sha256(localSpki) != enrollment.publicKeySpkiSha256 ||
            localDevicePublicMaterial.publicKeySpkiSha256 != enrollment.publicKeySpkiSha256
        ) return review("device_key_mismatch")
        if (
          signer.signerKeyId != signedAssignment.signerKeyId ||
            enrollment.deviceId != body.deviceId ||
            enrollment.keyId != body.keyId ||
            enrollment.receiverRevisionId != body.receiverRevisionId ||
            enrollment.receiverVersion != body.receiverVersion ||
            enrollment.receiverProfileDigest != body.receiverProfileDigest
        ) return review("device_binding_mismatch")
        if (
          enrollment.state != "active" ||
            assessedAt < enrollment.validFrom ||
            assessedAt >= enrollment.validUntil ||
            body.issuedAt < enrollment.validFrom ||
            body.expiresAt > enrollment.validUntil
        ) return review("device_revoked_or_expired")
        val issued = Instant.parse(body.issuedAt)
        val expires = Instant.parse(body.expiresAt)
        if (
          issued.isBefore(Instant.parse(body.submittedAt)) ||
            !expires.isAfter(issued) ||
            expires.toEpochMilli() - issued.toEpochMilli() > 300_000L ||
            assessedAt < body.issuedAt ||
            assessedAt >= body.expiresAt
        ) return review("lookup_expired")
        if (RoutineLookupCanonicalTranscripts.bodyDigest(body) != signedAssignment.bodyDigest) {
          return review("body_digest_mismatch")
        }
        val signature = Base64.getUrlDecoder().decode(signedAssignment.signature)
        if (signature.size != 64) return review("signature_invalid")
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(signerKey)
        verifier.update(RoutineLookupCanonicalTranscripts.signatureBytes(body))
        if (!verifier.verify(EcdsaP1363.p1363ToDer(signature))) {
          return review("signature_invalid")
        }
        RoutineLookupAssignmentAssessment(
          disposition = "would_open_assignment",
          reasonCode = "signed_assignment_matches_binding",
          authenticatedAssignment = AuthenticatedRoutineLookupAssignment(body),
        )
      }
      .getOrElse { review("invalid_request") }
  }

  private fun parseP256Spki(bytes: ByteArray): ECPublicKey? =
    runCatching {
        require(bytes.size in 64..512)
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(bytes)) as ECPublicKey
        require(key.encoded.contentEquals(bytes))
        val expected = AlgorithmParameters.getInstance("EC").run {
          init(ECGenParameterSpec("secp256r1"))
          getParameterSpec(ECParameterSpec::class.java)
        }
        require(key.params.curve == expected.curve)
        require(key.params.generator == expected.generator)
        require(key.params.order == expected.order)
        require(key.params.cofactor == expected.cofactor)
        key
      }
      .getOrNull()

  private fun review(reason: String): RoutineLookupAssignmentAssessment =
    RoutineLookupAssignmentAssessment("would_review", reason, null)
}
