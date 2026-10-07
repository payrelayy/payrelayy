package com.fetanagent.telebirrverifier

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets

/** Separate from the pilot bridge: these two paths cannot be used by its operational client. */
internal object RoutineNoMoneyBridgeProtocol {
  const val POLL_PATH = "/v1/telebirr/routine/assignments:poll"
  const val UPLOAD_PATH = "/v1/telebirr/routine/observations:upload"
  const val CONTENT_TYPE = "application/vnd.fetanagent.telebirr-routine-no-money.v1+json"
  const val MAX_POLL_BYTES = 4_096
  const val MAX_UPLOAD_BYTES = 48 * 1_024
  const val MAX_RESPONSE_BYTES = 16 * 1_024
}

/** Immutable origin, route, media type and size bounds for the review-only routine protocol. */
internal class FixedRoutineNoMoneyHttpsExchange(
  private val deploymentTarget: String = FixedDeviceBridgeHttpsExchange.PRODUCTION_DEPLOYMENT_TARGET,
  private val executor: DeviceBridgeHttpsExecutor = PlatformDeviceBridgeHttpsExecutor,
) : DeviceBridgeExchange {
  init {
    require(deploymentTarget == FixedDeviceBridgeHttpsExchange.STAGING_DEPLOYMENT_TARGET ||
      deploymentTarget == FixedDeviceBridgeHttpsExchange.PRODUCTION_DEPLOYMENT_TARGET)
  }

  override fun post(path: String, contentType: String, body: ByteArray): DeviceBridgeRawResponse {
    val maximumRequestBytes = when (path) {
      RoutineNoMoneyBridgeProtocol.POLL_PATH -> RoutineNoMoneyBridgeProtocol.MAX_POLL_BYTES
      RoutineNoMoneyBridgeProtocol.UPLOAD_PATH -> RoutineNoMoneyBridgeProtocol.MAX_UPLOAD_BYTES
      else -> throw IllegalArgumentException("Unsupported routine bridge path")
    }
    require(contentType == RoutineNoMoneyBridgeProtocol.CONTENT_TYPE)
    require(body.size in 1..maximumRequestBytes)
    val url = URI("https", null, FixedDeviceBridgeHttpsExchange.ORIGIN_HOST, 443, path, null, null).toURL()
    require(url.protocol == "https" && url.host == FixedDeviceBridgeHttpsExchange.ORIGIN_HOST &&
      url.port == 443 && url.path == path && url.userInfo == null && url.query == null && url.ref == null)

    val response = try {
      executor.execute(
        url, deploymentTarget, contentType, body,
        FixedDeviceBridgeHttpsExchange.CONNECT_TIMEOUT_MILLIS,
        FixedDeviceBridgeHttpsExchange.READ_TIMEOUT_MILLIS,
        RoutineNoMoneyBridgeProtocol.MAX_RESPONSE_BYTES,
      )
    } catch (_: IOException) {
      throw DeviceBridgeRetryableException()
    } catch (_: SecurityException) {
      throw DeviceBridgeRetryableException()
    }
    if (response.statusCode !in 100..599 || response.statusCode in 300..399 ||
      response.contentTypes.singleOrNull() != RoutineNoMoneyBridgeProtocol.CONTENT_TYPE ||
      response.contentEncodings.any { !it.equals("identity", ignoreCase = true) } ||
      response.contentEncodings.size > 1 ||
      response.body.size > RoutineNoMoneyBridgeProtocol.MAX_RESPONSE_BYTES
    ) throw DeviceBridgeRetryableException()
    return DeviceBridgeRawResponse(response.statusCode, RoutineNoMoneyBridgeProtocol.CONTENT_TYPE,
      response.body.copyOf())
  }

  override fun toString(): String =
    "FixedRoutineNoMoneyHttpsExchange(origin=${FixedDeviceBridgeHttpsExchange.ORIGIN_HOST},target=$deploymentTarget)"
}

internal sealed interface RoutineNoMoneyPhoneResult {
  data object NoAssignment : RoutineNoMoneyPhoneResult
  data object Retry : RoutineNoMoneyPhoneResult
  data object SubmittedForReview : RoutineNoMoneyPhoneResult
  data class Review(val reasonCode: String) : RoutineNoMoneyPhoneResult
}

/**
 * One-shot no-money rehearsal. It is deliberately not called by the UI or foreground service.
 * A future runtime must durably stage the exact signed pair before upload and enforce replay
 * recovery. This class has no database, payment claim, Player credit or money capability.
 */
internal class RoutineNoMoneyPhoneRehearsal(
  private val exchange: FixedRoutineNoMoneyHttpsExchange,
  private val collector: RoutineTelebirrObservationCollector,
  private val clock: MillisClock = MillisClock(System::currentTimeMillis),
) {
  fun run(
    receipt: RoutineSignedEnrollmentReceipt,
    receiptSigner: RoutineEnrollmentTrustedSigner,
    assignmentSigner: RoutineLookupTrustedSigner,
    assignmentSignerSpkiDer: ByteArray,
    deviceIdentity: P256Identity,
  ): RoutineNoMoneyPhoneResult {
    val poll = try {
      RoutineNoMoneyPollProtocol.create(receipt, receiptSigner, deviceIdentity, clock.nowMillis())
    } catch (_: Exception) {
      return RoutineNoMoneyPhoneResult.Review("enrollment_unavailable")
    }
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
    val pollResponse = try {
      val pollBytes = StrictJson.encode(obj(
        "publicKeySpki" to text(deviceIdentity.publicMaterial().publicKeySpkiBase64Url),
        "signedRequest" to StrictJson.parse(RoutineNoMoneyPollProtocol.encode(poll)),
      )).toByteArray(StandardCharsets.UTF_8)
      exchange.post(RoutineNoMoneyBridgeProtocol.POLL_PATH, RoutineNoMoneyBridgeProtocol.CONTENT_TYPE,
        pollBytes)
    } catch (_: Exception) {
      return RoutineNoMoneyPhoneResult.Retry
    }
    if (pollResponse.contentType != RoutineNoMoneyBridgeProtocol.CONTENT_TYPE) {
      return RoutineNoMoneyPhoneResult.Retry
    }
    if (pollResponse.statusCode == HttpURLConnection.HTTP_UNAVAILABLE) {
      return RoutineNoMoneyPhoneResult.Retry
    }
    if (pollResponse.statusCode == HttpURLConnection.HTTP_UNAUTHORIZED ||
      pollResponse.statusCode == HttpURLConnection.HTTP_FORBIDDEN) {
      return RoutineNoMoneyPhoneResult.Review("server_rejected")
    }
    if (pollResponse.statusCode != HttpURLConnection.HTTP_OK) {
      return RoutineNoMoneyPhoneResult.Retry
    }
    val assignmentBytes = try {
      val value = StrictJson.parse(pollResponse.body).requireObject(
        setOf("outcome", "advisoryOnly", "financialActionAllowed", "signedAssignment"))
      require(value.string("outcome") == "assignment" && value.boolean("advisoryOnly") &&
        !value.boolean("financialActionAllowed"))
      StrictJson.encode(value.value("signedAssignment"))
        .toByteArray(StandardCharsets.UTF_8)
    } catch (_: Exception) {
      if (isNoAssignment(pollResponse.body)) return RoutineNoMoneyPhoneResult.NoAssignment
      return RoutineNoMoneyPhoneResult.Review("invalid_assignment_response")
    }
    if (RoutineTelebirrJsonCodec.decodeSignedAssignment(assignmentBytes) == null) {
      return RoutineNoMoneyPhoneResult.Review("invalid_assignment_response")
    }
    val collected = collector.collect(
      assignmentBytes, assignmentSigner, assignmentSignerSpkiDer, enrollment, deviceIdentity,
    )
    if (collected is RoutineTelebirrObservationCollection.Review) {
      return RoutineNoMoneyPhoneResult.Review(collected.reasonCode)
    }
    val observation = (collected as RoutineTelebirrObservationCollection.WouldForward).observation
    val uploadBytes = try {
      val observationBytes = RoutineTelebirrJsonCodec.encodeSignedObservation(observation)
      StrictJson.encode(obj(
        "publicKeySpki" to text(deviceIdentity.publicMaterial().publicKeySpkiBase64Url),
        "signedAssignment" to StrictJson.parse(assignmentBytes),
        "signedObservation" to StrictJson.parse(observationBytes),
      )).toByteArray(StandardCharsets.UTF_8).also {
        require(it.size in 1..RoutineNoMoneyBridgeProtocol.MAX_UPLOAD_BYTES)
      }
    } catch (_: Exception) {
      return RoutineNoMoneyPhoneResult.Review("observation_invalid")
    }
    val uploadResponse = try {
      exchange.post(RoutineNoMoneyBridgeProtocol.UPLOAD_PATH, RoutineNoMoneyBridgeProtocol.CONTENT_TYPE,
        uploadBytes)
    } catch (_: Exception) {
      return RoutineNoMoneyPhoneResult.Retry
    }
    if (uploadResponse.contentType != RoutineNoMoneyBridgeProtocol.CONTENT_TYPE ||
      uploadResponse.statusCode == HttpURLConnection.HTTP_UNAVAILABLE) {
      return RoutineNoMoneyPhoneResult.Retry
    }
    if (uploadResponse.statusCode != HttpURLConnection.HTTP_ACCEPTED) {
      return RoutineNoMoneyPhoneResult.Review("upload_rejected")
    }
    return try {
      val value = StrictJson.parse(uploadResponse.body).requireObject(
        setOf("outcome", "advisoryOnly", "sourceAuthenticationPerformed", "financialActionAllowed"))
      require(value.boolean("advisoryOnly") && !value.boolean("sourceAuthenticationPerformed") &&
        !value.boolean("financialActionAllowed"))
      when (value.string("outcome")) {
        "signed_evidence_received_for_review" -> RoutineNoMoneyPhoneResult.SubmittedForReview
        "review" -> RoutineNoMoneyPhoneResult.Review("server_review")
        else -> RoutineNoMoneyPhoneResult.Review("invalid_upload_response")
      }
    } catch (_: Exception) {
      RoutineNoMoneyPhoneResult.Review("invalid_upload_response")
    }
  }

  private fun isNoAssignment(body: ByteArray): Boolean = try {
    val value = StrictJson.parse(body).requireObject(
      setOf("outcome", "advisoryOnly", "financialActionAllowed"))
    value.string("outcome") == "no_assignment" && value.boolean("advisoryOnly") &&
      !value.boolean("financialActionAllowed")
  } catch (_: Exception) {
    false
  }
}
