package com.fetanagent.telebirrverifier

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder

/** Distinct from both the pilot and the no-money phone routes. */
internal object RoutinePaidBridgeProtocol {
  const val POLL_PATH = "/v1/telebirr/routine/paid/assignments:poll"
  const val CONTENT_TYPE = "application/vnd.fetanagent.telebirr-routine-paid-poll.v1+json"
  const val UPLOAD_PATH = "/v1/telebirr/routine/paid/observations:upload"
  const val UPLOAD_CONTENT_TYPE =
    "application/vnd.fetanagent.telebirr-routine-paid-observation.v1+json"
  const val MAX_POLL_BYTES = 4_096
  const val MAX_RESPONSE_BYTES = 16 * 1_024
  const val MAX_UPLOAD_BYTES = 48 * 1_024
}

/** An exact HTTPS paid transport; it cannot contact the no-money or pilot endpoints. */
internal class FixedRoutinePaidPollHttpsExchange(
  private val deploymentTarget: String = FixedDeviceBridgeHttpsExchange.PRODUCTION_DEPLOYMENT_TARGET,
  private val executor: DeviceBridgeHttpsExecutor = PlatformDeviceBridgeHttpsExecutor,
) : DeviceBridgeExchange {
  init {
    require(deploymentTarget == FixedDeviceBridgeHttpsExchange.STAGING_DEPLOYMENT_TARGET ||
      deploymentTarget == FixedDeviceBridgeHttpsExchange.PRODUCTION_DEPLOYMENT_TARGET)
  }

  override fun post(path: String, contentType: String, body: ByteArray): DeviceBridgeRawResponse {
    val maximum = when (path) {
      RoutinePaidBridgeProtocol.POLL_PATH -> {
        require(contentType == RoutinePaidBridgeProtocol.CONTENT_TYPE)
        RoutinePaidBridgeProtocol.MAX_POLL_BYTES
      }
      RoutinePaidBridgeProtocol.UPLOAD_PATH -> {
        require(contentType == RoutinePaidBridgeProtocol.UPLOAD_CONTENT_TYPE)
        RoutinePaidBridgeProtocol.MAX_UPLOAD_BYTES
      }
      else -> throw IllegalArgumentException("Unsupported paid bridge path")
    }
    require(body.size in 1..maximum)
    val url = URI("https", null, FixedDeviceBridgeHttpsExchange.ORIGIN_HOST, 443,
      path, null, null).toURL()
    require(url.protocol == "https" && url.host == FixedDeviceBridgeHttpsExchange.ORIGIN_HOST &&
      url.port == 443 && url.path == path && url.userInfo == null && url.query == null &&
      url.ref == null)
    val response = try {
      executor.execute(url, deploymentTarget, contentType, body,
        FixedDeviceBridgeHttpsExchange.CONNECT_TIMEOUT_MILLIS,
        FixedDeviceBridgeHttpsExchange.READ_TIMEOUT_MILLIS,
        RoutinePaidBridgeProtocol.MAX_RESPONSE_BYTES)
    } catch (_: IOException) {
      throw DeviceBridgeRetryableException()
    } catch (_: SecurityException) {
      throw DeviceBridgeRetryableException()
    }
    if (response.statusCode !in 100..599 || response.statusCode in 300..399 ||
      response.contentTypes.singleOrNull() != contentType ||
      response.contentEncodings.any { !it.equals("identity", ignoreCase = true) } ||
      response.contentEncodings.size > 1 ||
      response.body.size > RoutinePaidBridgeProtocol.MAX_RESPONSE_BYTES
    ) throw DeviceBridgeRetryableException()
    return DeviceBridgeRawResponse(response.statusCode, contentType,
      response.body.copyOf())
  }

  override fun toString(): String =
    "FixedRoutinePaidPollHttpsExchange(origin=${FixedDeviceBridgeHttpsExchange.ORIGIN_HOST},target=$deploymentTarget)"
}

internal sealed interface RoutinePaidPhonePreparationResult {
  data object NoAssignment : RoutinePaidPhonePreparationResult
  data object Retry : RoutinePaidPhonePreparationResult
  data object SubmittedForReview : RoutinePaidPhonePreparationResult
  data class Review(val reasonCode: String) : RoutinePaidPhonePreparationResult
}

/**
 * Paid phone poll, official receipt lookup, and retry-safe signed observation upload.
 * The assignment and observation are sealed before further I/O. Upload stages evidence for
 * server review; it does not create a payment claim or credit a Player.
 */
internal class RoutinePaidPhonePreparation(
  private val exchange: FixedRoutinePaidPollHttpsExchange,
  private val collector: RoutineTelebirrObservationCollector,
  private val workStore: RoutinePaidWorkStore,
  private val clock: MillisClock = MillisClock(System::currentTimeMillis),
) {
  @Synchronized
  fun run(
    receipt: RoutineSignedEnrollmentReceipt,
    receiptSigner: RoutineEnrollmentTrustedSigner,
    assignmentSigner: RoutineLookupTrustedSigner,
    assignmentSignerSpkiDer: ByteArray,
    deviceIdentity: P256Identity,
  ): RoutinePaidPhonePreparationResult {
    val now = try { clock.nowMillis() } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("clock_unavailable")
    }
    val pending = try { workStore.load() } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("local_work_unavailable")
    }
    if (pending is RoutinePaidPendingWork.Assignment) {
      val staged = RoutineTelebirrJsonCodec.decodeSignedAssignment(pending.assignmentBytes)
        ?: return RoutinePaidPhonePreparationResult.Review("local_work_unavailable")
      if (now >= Instant.parse(staged.body.expiresAt).toEpochMilli()) {
        try { workStore.discardExpiredAssignment(now) } catch (_: Exception) {
          return RoutinePaidPhonePreparationResult.Review("local_work_unavailable")
        }
        return RoutinePaidPhonePreparationResult.Review("lookup_expired")
      }
    }
    val poll = if (pending == null) try {
      RoutinePaidPollProtocol.create(receipt, receiptSigner, deviceIdentity, now)
    } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("enrollment_unavailable")
    } else null
    val material = try { deviceIdentity.publicMaterial() } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("device_key_unavailable")
    }
    val assessedAt = try {
      DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.ofEpochMilli(now))
    } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("clock_unavailable")
    }
    if (receipt.body.assignmentPollingAllowed || receipt.body.financialActionAllowed ||
      receipt.body.moneyMovementAllowed ||
      !RoutineEnrollmentReceiptProtocol.verifyExistingLocalKey(
        receipt, receiptSigner, material, assessedAt)) {
      return RoutinePaidPhonePreparationResult.Review("enrollment_unavailable")
    }
    if (pending is RoutinePaidPendingWork.Upload) return uploadPending(pending.uploadBytes)
    val assignmentBytes = if (pending is RoutinePaidPendingWork.Assignment) {
      pending.assignmentBytes
    } else {
      val pollResponse = try {
        val bytes = StrictJson.encode(obj(
          "publicKeySpki" to text(material.publicKeySpkiBase64Url),
          "signedRequest" to StrictJson.parse(RoutinePaidPollProtocol.encode(requireNotNull(poll))),
        )).toByteArray(StandardCharsets.UTF_8)
        exchange.post(RoutinePaidBridgeProtocol.POLL_PATH, RoutinePaidBridgeProtocol.CONTENT_TYPE,
          bytes)
      } catch (_: Exception) {
        return RoutinePaidPhonePreparationResult.Retry
      }
      if (pollResponse.contentType != RoutinePaidBridgeProtocol.CONTENT_TYPE ||
        pollResponse.statusCode == HttpURLConnection.HTTP_UNAVAILABLE) {
        return RoutinePaidPhonePreparationResult.Retry
      }
      if (pollResponse.statusCode == HttpURLConnection.HTTP_UNAUTHORIZED ||
        pollResponse.statusCode == HttpURLConnection.HTTP_FORBIDDEN) {
        return RoutinePaidPhonePreparationResult.Review("server_rejected")
      }
      if (pollResponse.statusCode != HttpURLConnection.HTTP_OK) {
        return RoutinePaidPhonePreparationResult.Retry
      }
      val parsed = try {
        val value = StrictJson.parse(pollResponse.body)
        val frame = value.requireObject(setOf("outcome", "advisoryOnly",
          "paymentVerificationRequested", "financialActionAllowed", "signedAssignment"))
        require(frame.string("outcome") == "assignment" && frame.boolean("advisoryOnly") &&
          frame.boolean("paymentVerificationRequested") && !frame.boolean("financialActionAllowed"))
        StrictJson.encode(frame.value("signedAssignment")).toByteArray(StandardCharsets.UTF_8)
      } catch (_: Exception) {
        if (isNoAssignment(pollResponse.body)) return RoutinePaidPhonePreparationResult.NoAssignment
        return RoutinePaidPhonePreparationResult.Review("invalid_assignment_response")
      }
      parsed
    }
    val signedAssignment = RoutineTelebirrJsonCodec.decodeSignedAssignment(assignmentBytes)
      ?: return RoutinePaidPhonePreparationResult.Review("invalid_assignment_response")
    val enrollment = receipt.body.let { body ->
      RoutineLookupDeviceEnrollment(
        deviceId = body.deviceId,
        keyId = body.keyId,
        publicKeySpkiSha256 = body.devicePublicKeySpkiSha256,
        state = "active",
        validFrom = body.validFrom,
        validUntil = body.validUntil,
        receiverRevisionId = body.receiverRevisionId,
        receiverVersion = body.receiverVersion,
        receiverProfileDigest = body.receiverProfileDigest,
      )
    }
    // The broker issues the challenge after the poll starts, so the pre-poll
    // enrollment timestamp cannot be used to assess the returned assignment.
    val assignmentAssessedMillis = try { clock.nowMillis() } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("clock_unavailable")
    }
    val assignmentAssessedAt = try {
      DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(
        Instant.ofEpochMilli(assignmentAssessedMillis))
    } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("clock_unavailable")
    }
    val assessment = RoutineLookupAssignmentVerifier.verify(assignmentSigner, enrollment,
      signedAssignment, assignmentSignerSpkiDer, material, assignmentAssessedAt)
    if (assessment.authenticatedAssignment == null) {
      if (assessment.reasonCode == "lookup_expired" && pending is RoutinePaidPendingWork.Assignment) {
        try { workStore.discardExpiredAssignment(assignmentAssessedMillis) } catch (_: Exception) {
          return RoutinePaidPhonePreparationResult.Review("local_work_unavailable")
        }
      }
      return RoutinePaidPhonePreparationResult.Review(assessment.reasonCode)
    }
    if (pending == null) {
      try { workStore.stageAssignment(assignmentBytes) } catch (_: Exception) {
        return RoutinePaidPhonePreparationResult.Review("local_work_unavailable")
      }
    }
    val collected = collector.collect(assignmentBytes, assignmentSigner,
      assignmentSignerSpkiDer, enrollment, deviceIdentity)
    if (collected is RoutineTelebirrObservationCollection.Review) {
      if (collected.reasonCode == "lookup_expired") {
        try { workStore.discardExpiredAssignment(clock.nowMillis()) } catch (_: Exception) {
          return RoutinePaidPhonePreparationResult.Review("local_work_unavailable")
        }
      }
      return RoutinePaidPhonePreparationResult.Review(collected.reasonCode)
    }
    val observation = (collected as RoutineTelebirrObservationCollection.WouldForward).observation
    val upload = try {
      val encoded = RoutineTelebirrJsonCodec.encodeSignedObservation(observation)
      StrictJson.encode(obj(
        "publicKeySpki" to text(material.publicKeySpkiBase64Url),
        "signedAssignment" to StrictJson.parse(assignmentBytes),
        "signedObservation" to StrictJson.parse(encoded),
      )).toByteArray(StandardCharsets.UTF_8).also {
        require(it.size in 1..RoutinePaidBridgeProtocol.MAX_UPLOAD_BYTES)
      }
    } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("observation_invalid")
    }
    try { workStore.stageUpload(assignmentBytes, upload) } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("local_work_unavailable")
    }
    return uploadPending(upload)
  }

  private fun uploadPending(bytes: ByteArray): RoutinePaidPhonePreparationResult {
    val response = try {
      exchange.post(RoutinePaidBridgeProtocol.UPLOAD_PATH,
        RoutinePaidBridgeProtocol.UPLOAD_CONTENT_TYPE, bytes)
    } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Retry
    }
    if (response.contentType != RoutinePaidBridgeProtocol.UPLOAD_CONTENT_TYPE ||
      response.statusCode >= 500 || response.statusCode == 429) {
      return RoutinePaidPhonePreparationResult.Retry
    }
    if (response.statusCode == HttpURLConnection.HTTP_CONFLICT) {
      return RoutinePaidPhonePreparationResult.Review("observation_conflict")
    }
    if (response.statusCode == HttpURLConnection.HTTP_UNAUTHORIZED ||
      response.statusCode == HttpURLConnection.HTTP_FORBIDDEN) {
      return RoutinePaidPhonePreparationResult.Review("server_rejected")
    }
    if (response.statusCode != HttpURLConnection.HTTP_ACCEPTED) {
      return RoutinePaidPhonePreparationResult.Review("upload_rejected")
    }
    val accepted = try {
      val frame = StrictJson.parse(response.body).requireObject(setOf(
        "outcome", "advisoryOnly", "paymentVerificationRequested",
        "pairedPhoneEvidenceVerified", "sourceAuthenticationPerformed",
        "financialActionAllowed"))
      frame.string("outcome") == "signed_paid_observation_staged" &&
        frame.boolean("advisoryOnly") && frame.boolean("paymentVerificationRequested") &&
        frame.boolean("pairedPhoneEvidenceVerified") &&
        !frame.boolean("sourceAuthenticationPerformed") &&
        !frame.boolean("financialActionAllowed")
    } catch (_: Exception) { false }
    if (!accepted) return RoutinePaidPhonePreparationResult.Review("invalid_upload_response")
    try { workStore.acknowledge(bytes) } catch (_: Exception) {
      return RoutinePaidPhonePreparationResult.Review("local_work_unavailable")
    }
    return RoutinePaidPhonePreparationResult.SubmittedForReview
  }

  private fun isNoAssignment(body: ByteArray): Boolean = try {
    val value = StrictJson.parse(body).requireObject(setOf("outcome", "advisoryOnly",
      "paymentVerificationRequested", "financialActionAllowed"))
    value.string("outcome") == "no_assignment" && value.boolean("advisoryOnly") &&
      value.boolean("paymentVerificationRequested") && !value.boolean("financialActionAllowed")
  } catch (_: Exception) {
    false
  }
}
