package com.fetanagent.telebirrverifier

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.Base64
import java.util.UUID

/** A phone-signed request only. The server must independently authorize each lookup. */
internal data class RoutineNoMoneyPollBody(
  val contractVersion: Int = 1,
  val providerCode: String = "telebirr",
  val protocolMode: String = RoutineNoMoneyPollProtocol.MODE,
  val enrollmentId: String,
  val deviceId: String,
  val keyId: String,
  val receiverRevisionId: String,
  val receiverProfileDigest: String,
  val requestId: String,
  val issuedAt: String,
  val expiresAt: String,
  val evidenceOnly: Boolean = true,
  val financialActionAllowed: Boolean = false,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    require(contractVersion == 1 && providerCode == "telebirr" && protocolMode == RoutineNoMoneyPollProtocol.MODE)
    require(p.UUID_V4.matches(enrollmentId) && p.UUID_V4.matches(receiverRevisionId))
    require(p.OPAQUE_ID.matches(deviceId) && p.OPAQUE_ID.matches(keyId))
    require(p.DIGEST.matches(receiverProfileDigest) && p.UUID_V4.matches(requestId))
    p.requireUtc(issuedAt)
    p.requireUtc(expiresAt)
    val issued = Instant.parse(issuedAt).toEpochMilli()
    val expires = Instant.parse(expiresAt).toEpochMilli()
    require(expires - issued in 1..60_000)
    require(evidenceOnly && !financialActionAllowed)
  }

  override fun toString(): String = "RoutineNoMoneyPollBody(<redacted>)"
}

internal data class RoutineSignedNoMoneyPollRequest(
  val contractVersion: Int = 1,
  val providerCode: String = "telebirr",
  val protocolMode: String = RoutineNoMoneyPollProtocol.MODE,
  val transcriptVersion: String = RoutineNoMoneyPollProtocol.TRANSCRIPT,
  val bodyDigestAlgorithm: String = "sha256",
  val bodyDigest: String,
  val signatureAlgorithm: String = "ecdsa-p256-sha256",
  val signatureEncoding: String = "ieee-p1363-base64url",
  val body: RoutineNoMoneyPollBody,
  val signature: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    require(contractVersion == 1 && providerCode == "telebirr" && protocolMode == RoutineNoMoneyPollProtocol.MODE)
    require(transcriptVersion == RoutineNoMoneyPollProtocol.TRANSCRIPT)
    require(bodyDigestAlgorithm == "sha256" && p.DIGEST.matches(bodyDigest))
    require(signatureAlgorithm == "ecdsa-p256-sha256" && signatureEncoding == "ieee-p1363-base64url")
    require(p.SIGNATURE.matches(signature))
    val decoded = Base64.getUrlDecoder().decode(signature)
    require(decoded.size == 64 && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == signature)
  }

  override fun toString(): String = "RoutineSignedNoMoneyPollRequest(<redacted>)"
}

internal object RoutineNoMoneyPollProtocol {
  const val MODE = "routine_no_money_poll_v1"
  const val TRANSCRIPT = "telebirr-routine-no-money-poll-transcript-v1"

  fun bodyBytes(body: RoutineNoMoneyPollBody): ByteArray = RoutineLookupCanonicalTranscripts.encode(
    "fetanagent:telebirr:routine:no-money-poll-body:v1",
    listOf(
      "contractVersion" to body.contractVersion,
      "providerCode" to body.providerCode,
      "protocolMode" to body.protocolMode,
      "enrollmentId" to body.enrollmentId,
      "deviceId" to body.deviceId,
      "keyId" to body.keyId,
      "receiverRevisionId" to body.receiverRevisionId,
      "receiverProfileDigest" to body.receiverProfileDigest,
      "requestId" to body.requestId,
      "issuedAt" to body.issuedAt,
      "expiresAt" to body.expiresAt,
      "evidenceOnly" to body.evidenceOnly,
      "financialActionAllowed" to body.financialActionAllowed,
    ),
  )

  fun bodyDigest(body: RoutineNoMoneyPollBody): String =
    RoutineLookupCanonicalTranscripts.sha256(bodyBytes(body))

  fun signatureBytes(body: RoutineNoMoneyPollBody): ByteArray =
    RoutineLookupCanonicalTranscripts.encode(
      TRANSCRIPT, listOf("bodyDigest" to bodyDigest(body)),
    )

  /** Rechecks the pinned receipt signer and local key. The result still never grants polling. */
  fun create(
    receipt: RoutineSignedEnrollmentReceipt,
    trustedSigner: RoutineEnrollmentTrustedSigner,
    identity: P256Identity,
    nowMillis: Long,
    requestId: String = UUID.randomUUID().toString(),
  ): RoutineSignedNoMoneyPollRequest {
    val enrollment = receipt.body
    val material = identity.publicMaterial()
    require(enrollment.keyId == identity.keyId && material.keyId == identity.keyId)
    require(enrollment.devicePublicKeySpkiSha256 == material.publicKeySpkiSha256)
    require(!enrollment.assignmentPollingAllowed && !enrollment.financialActionAllowed)
    val validFrom = Instant.parse(enrollment.validFrom).toEpochMilli()
    val validUntil = Instant.parse(enrollment.validUntil).toEpochMilli()
    require(nowMillis in validFrom until validUntil)
    val formatter = DateTimeFormatterBuilder().appendInstant(3).toFormatter()
    require(RoutineEnrollmentReceiptProtocol.verifyExistingLocalKey(
      receipt, trustedSigner, material, formatter.format(Instant.ofEpochMilli(nowMillis)),
    ))
    val issued = maxOf(validFrom, nowMillis - 30_000)
    val expires = minOf(validUntil, issued + 60_000)
    require(expires > nowMillis && expires > issued)
    val body = RoutineNoMoneyPollBody(
      enrollmentId = enrollment.enrollmentId,
      deviceId = enrollment.deviceId,
      keyId = enrollment.keyId,
      receiverRevisionId = enrollment.receiverRevisionId,
      receiverProfileDigest = enrollment.receiverProfileDigest,
      requestId = requestId,
      issuedAt = formatter.format(Instant.ofEpochMilli(issued)),
      expiresAt = formatter.format(Instant.ofEpochMilli(expires)),
    )
    val signature = identity.signP1363(signatureBytes(body))
    require(signature.size == 64)
    return RoutineSignedNoMoneyPollRequest(
      bodyDigest = bodyDigest(body),
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signature),
    )
  }

  fun encode(request: RoutineSignedNoMoneyPollRequest): ByteArray {
    require(bodyDigest(request.body) == request.bodyDigest)
    val body = request.body
    val bytes = StrictJson.encode(obj(
      "contractVersion" to number(request.contractVersion.toLong()),
      "providerCode" to text(request.providerCode),
      "protocolMode" to text(request.protocolMode),
      "transcriptVersion" to text(request.transcriptVersion),
      "bodyDigestAlgorithm" to text(request.bodyDigestAlgorithm),
      "bodyDigest" to text(request.bodyDigest),
      "signatureAlgorithm" to text(request.signatureAlgorithm),
      "signatureEncoding" to text(request.signatureEncoding),
      "body" to obj(
        "contractVersion" to number(body.contractVersion.toLong()),
        "providerCode" to text(body.providerCode),
        "protocolMode" to text(body.protocolMode),
        "enrollmentId" to text(body.enrollmentId),
        "deviceId" to text(body.deviceId),
        "keyId" to text(body.keyId),
        "receiverRevisionId" to text(body.receiverRevisionId),
        "receiverProfileDigest" to text(body.receiverProfileDigest),
        "requestId" to text(body.requestId),
        "issuedAt" to text(body.issuedAt),
        "expiresAt" to text(body.expiresAt),
        "evidenceOnly" to bool(body.evidenceOnly),
        "financialActionAllowed" to bool(body.financialActionAllowed),
      ),
      "signature" to text(request.signature),
    )).toByteArray(StandardCharsets.UTF_8)
    require(bytes.size in 1..4_096)
    return bytes
  }
}
