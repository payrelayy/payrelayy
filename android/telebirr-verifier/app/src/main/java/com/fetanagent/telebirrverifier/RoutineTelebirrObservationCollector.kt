package com.fetanagent.telebirrverifier

import java.time.Instant
import java.time.format.DateTimeFormatterBuilder

/**
 * A local, evidence-only composition of the routine assignment, official receipt, and device
 * signature contracts. Nothing calls this from the operational service or UI. In particular,
 * this class does not poll for assignments, upload observations, write to a database, or act on a
 * payment. Its signer and enrollment inputs must come from independently trusted material; its
 * transport must be the reviewed official HTTPS transport before any operational use. Only that
 * transport can make this collector sign a version-2 phone-origin assertion. A test transport
 * can claim false origin but produces only version-1 review evidence. Neither version authorizes
 * a financial action on the phone; the server must verify the enrollment and signed transcript.
 */
internal class RoutineTelebirrObservationCollector(
  private val transport: ProviderTransport,
  private val parser: RoutineTelebirrReceiptParser = RoutineTelebirrReceiptParser(),
  private val clock: MillisClock = MillisClock { System.currentTimeMillis() },
) {
  fun collect(
    assignmentBytes: ByteArray,
    trustedSigner: RoutineLookupTrustedSigner,
    signerPublicSpkiDer: ByteArray,
    trustedEnrollment: RoutineLookupDeviceEnrollment,
    deviceIdentity: P256Identity,
  ): RoutineTelebirrObservationCollection {
    val startedAtMillis = try { clock.nowMillis() } catch (_: Exception) {
      return RoutineTelebirrObservationCollection.Review("clock_unavailable")
    }
    val assessedAt = try {
      DateTimeFormatterBuilder().appendInstant(3).toFormatter()
        .format(Instant.ofEpochMilli(startedAtMillis))
    } catch (_: Exception) {
      return RoutineTelebirrObservationCollection.Review("clock_unavailable")
    }
    val assignment = RoutineTelebirrJsonCodec.decodeSignedAssignment(assignmentBytes)
      ?: return RoutineTelebirrObservationCollection.Review("invalid_assignment")
    val localPublicMaterial = try { deviceIdentity.publicMaterial() } catch (_: Exception) {
      return RoutineTelebirrObservationCollection.Review("device_key_unavailable")
    }
    val assessment = RoutineLookupAssignmentVerifier.verify(
      signer = trustedSigner,
      enrollment = trustedEnrollment,
      signedAssignment = assignment,
      signerPublicSpkiDer = signerPublicSpkiDer,
      localDevicePublicMaterial = localPublicMaterial,
      assessedAt = assessedAt,
    )
    val authenticated = assessment.authenticatedAssignment
      ?: return RoutineTelebirrObservationCollection.Review(assessment.reasonCode)
    val expectation = authenticated.receiptExpectation()
    val document = try {
      transport.retrieve(
        OfficialReceiptRoute.forReference(CanonicalReference.fromCanonical(expectation.rawReference)),
      )
    } catch (_: Exception) {
      return RoutineTelebirrObservationCollection.Review("transport_unavailable")
    }
    val completedAtMillis = try { clock.nowMillis() } catch (_: Exception) {
      return RoutineTelebirrObservationCollection.Review("clock_unavailable")
    }
    if (completedAtMillis < startedAtMillis ||
      completedAtMillis >= Instant.parse(assignment.body.expiresAt).toEpochMilli()
    ) return RoutineTelebirrObservationCollection.Review("lookup_expired")
    val parsed = try {
      parser.parse(document, expectation)
    } catch (_: Exception) {
      return RoutineTelebirrObservationCollection.Review("receipt_review")
    }
    if (parsed is RoutineTelebirrParsedReceipt.Review) {
      return RoutineTelebirrObservationCollection.Review(parsed.reasonCode)
    }
    val observation = try {
      RoutineTelebirrSignedObservationFactory.create(
        authenticated,
        trustedEnrollment,
        parsed as RoutineTelebirrParsedReceipt.Observed,
        deviceIdentity,
        officialOriginFromSafeTransport = transport is SafeOfficialReceiptTransport &&
          document is ProviderDocument.Found &&
          document.originAttestation == ProviderDocumentOriginAttestation.OFFICIAL_TLS_ORIGIN,
      )
    } catch (_: Exception) {
      return RoutineTelebirrObservationCollection.Review("observation_invalid")
    }
    return RoutineTelebirrObservationCollection.WouldForward(observation)
  }
}

internal sealed interface RoutineTelebirrObservationCollection {
  val advisoryOnly: Boolean get() = true
  val sourceAuthenticationPerformedByServer: Boolean get() = false
  val databaseWriteAllowed: Boolean get() = false
  val claimAllowed: Boolean get() = false
  val settlementAllowed: Boolean get() = false
  val enqueueAllowed: Boolean get() = false
  val executionAllowed: Boolean get() = false
  val financialActionAllowed: Boolean get() = false

  data class Review(val reasonCode: String) : RoutineTelebirrObservationCollection

  data class WouldForward(val observation: RoutineTelebirrSignedObservation) :
    RoutineTelebirrObservationCollection {
    override fun toString(): String = "RoutineTelebirrObservationCollection.WouldForward(<redacted>)"
  }
}
