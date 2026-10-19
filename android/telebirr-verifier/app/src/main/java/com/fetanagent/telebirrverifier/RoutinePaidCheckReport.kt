package com.fetanagent.telebirrverifier

import com.google.gson.stream.JsonWriter
import java.io.StringWriter
import java.nio.charset.StandardCharsets
import java.util.Base64

/** One redacted, signed phone check result. It contains no receipt text or money authority. */
internal object RoutinePaidCheckReport {
  private val reasonCode = Regex("[a-z][a-z0-9_]{0,63}")

  private fun transcript(
    candidateId: String,
    challengeId: String,
    challengeDigest: String,
    reason: String,
    checkedAt: String,
  ): ByteArray {
    val output = StringWriter()
    JsonWriter(output).use { writer ->
      writer.beginArray()
      writer.value("telebirr-routine-paid-check-reason-v1")
      writer.value(1)
      writer.value(candidateId)
      writer.value(challengeId)
      writer.value(challengeDigest)
      writer.value(reason)
      writer.value(checkedAt)
      writer.endArray()
    }
    return output.toString().toByteArray(StandardCharsets.UTF_8)
  }

  fun encodeUpload(
    assignmentBytes: ByteArray,
    assignment: AuthenticatedRoutineLookupAssignment,
    reason: String,
    checkedAt: String,
    identity: P256Identity,
  ): ByteArray {
    require(reasonCode.matches(reason))
    RoutineTelebirrLookupProtocol.requireUtc(checkedAt)
    val body = assignment.body
    require(checkedAt >= body.issuedAt && checkedAt <= body.expiresAt)
    val signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
      identity.signP1363(transcript(body.candidateId, body.challengeId,
        body.challengeDigest, reason, checkedAt)),
    )
    require(RoutineTelebirrLookupProtocol.SIGNATURE.matches(signature))
    val encoded = StrictJson.encode(obj(
      "publicKeySpki" to text(identity.publicMaterial().publicKeySpkiBase64Url),
      "signedAssignment" to StrictJson.parse(assignmentBytes),
      "signedCheck" to obj(
        "body" to obj(
          "version" to number(1),
          "candidateId" to text(body.candidateId),
          "challengeId" to text(body.challengeId),
          "challengeDigest" to text(body.challengeDigest),
          "reasonCode" to text(reason),
          "checkedAt" to text(checkedAt),
        ),
        "signature" to text(signature),
      ),
    )).toByteArray(StandardCharsets.UTF_8)
    require(encoded.size in 1..RoutinePaidBridgeProtocol.MAX_UPLOAD_BYTES)
    return encoded
  }
}
