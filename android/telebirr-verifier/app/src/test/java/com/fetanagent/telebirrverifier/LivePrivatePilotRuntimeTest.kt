package com.fetanagent.telebirrverifier

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePrivatePilotRuntimeTest {
  @Test
  fun `disabled gates perform no key network provider or upload work`() {
    val fixture = RuntimeFixture()
    var sourceCalls = 0
    var transportCalls = 0
    var uploadCalls = 0
    val identity =
      object : P256Identity {
        override val keyId = fixture.device.keyId

        override fun publicMaterial(): IdentityPublicMaterial =
          error("disabled runtime must not open the device key")

        override fun signP1363(message: ByteArray): ByteArray =
          error("disabled runtime must not sign")
      }
    val coordinator =
      fixture.coordinator(
        gate = LivePilotRuntimeGate.disabled(),
        identity = identity,
        assignmentSource = LivePilotAssignmentSource {
          sourceCalls += 1
          fixture.signedAssignment
        },
        transport = ProviderTransport {
          transportCalls += 1
          livePilotProviderFound()
        },
        uploader = LivePilotObservationUploader { _, _ ->
          uploadCalls += 1
          LivePilotUploadResult.Retryable
        },
      )

    val status = coordinator.runOnce()

    assertEquals(LivePilotRuntimeState.DISABLED, status.state)
    assertEquals("build_disabled", status.code)
    assertEquals(0, sourceCalls)
    assertEquals(0, transportCalls)
    assertEquals(0, uploadCalls)
    assertNoAuthority(status)
  }

  @Test
  fun `expired enrollment stops before key network provider or upload work`() {
    val fixture = RuntimeFixture()
    var sourceCalls = 0
    var transportCalls = 0
    var uploadCalls = 0
    val identity =
      object : P256Identity {
        override val keyId = fixture.device.keyId

        override fun publicMaterial(): IdentityPublicMaterial =
          error("expired enrollment must not open the device key")

        override fun signP1363(message: ByteArray): ByteArray =
          error("expired enrollment must not sign")
      }
    val enrollment =
      livePilotEnrollment(fixture.device).copy(validUntil = "2026-08-20T18:02:59.999Z")
    val coordinator =
      fixture.coordinator(
        enrollment = enrollment,
        identity = identity,
        assignmentSource = LivePilotAssignmentSource {
          sourceCalls += 1
          fixture.signedAssignment
        },
        transport = ProviderTransport {
          transportCalls += 1
          livePilotProviderFound()
        },
        uploader = LivePilotObservationUploader { _, _ ->
          uploadCalls += 1
          LivePilotUploadResult.Retryable
        },
      )

    val status = coordinator.runOnce()

    assertEquals(LivePilotRuntimeState.ENROLLMENT_REQUIRED, status.state)
    assertEquals("device_enrollment_expired", status.code)
    assertEquals(0, sourceCalls)
    assertEquals(0, transportCalls)
    assertEquals(0, uploadCalls)
    assertNoAuthority(status)
  }

  @Test
  fun `distinguishes enrollment rejection retryable outage and invalid channel response`() {
    val fixture = RuntimeFixture()
    val enrollmentRejected =
      fixture
        .coordinator(
          assignmentSource = LivePilotAssignmentSource {
            throw DeviceBridgeEnrollmentRejectedException()
          },
        )
        .runOnce()
    val retryable =
      fixture
        .coordinator(
          assignmentSource = LivePilotAssignmentSource {
            throw DeviceBridgeRetryableException()
          },
        )
        .runOnce()
    val invalid =
      fixture
        .coordinator(assignmentSource = LivePilotAssignmentSource { error("sensitive failure") })
        .runOnce()

    assertEquals(LivePilotRuntimeState.ENROLLMENT_REQUIRED, enrollmentRejected.state)
    assertEquals("device_enrollment_rejected", enrollmentRejected.code)
    assertEquals(LivePilotRuntimeState.ATTENTION, retryable.state)
    assertEquals("assignment_channel_retryable", retryable.code)
    assertEquals(LivePilotRuntimeState.ATTENTION, invalid.state)
    assertEquals("assignment_response_invalid", invalid.code)
    assertFalse(invalid.toString().contains("sensitive failure"))
  }

  @Test
  fun `verifies observes signs uploads and acknowledges one assignment exactly once`() {
    val fixture = RuntimeFixture()
    var sourceCalls = 0
    var transportCalls = 0
    var uploadCalls = 0
    var uploaded: LivePilotSignedObservation? = null
    val coordinator =
      fixture.coordinator(
        assignmentSource = LivePilotAssignmentSource {
          sourceCalls += 1
          fixture.signedAssignment
        },
        transport = ProviderTransport { route ->
          transportCalls += 1
          assertEquals(OfficialReceiptRoute.OFFICIAL_HOST, route.host)
          assertFalse(route.toString().contains(PILOT_REFERENCE))
          livePilotProviderFound()
        },
        uploader = LivePilotObservationUploader { _, observation ->
          uploadCalls += 1
          uploaded = observation
          LivePilotUploadResult.Acknowledged(observation.bodyDigest)
        },
      )

    val first = coordinator.runOnce()
    val second = coordinator.runOnce()

    assertEquals(LivePilotRuntimeState.READY, first.state)
    assertEquals("observation_acknowledged", first.code)
    assertEquals("found", first.lookupOutcome)
    assertEquals(LivePilotRuntimeState.READY, second.state)
    assertEquals("assignment_already_acknowledged", second.code)
    assertEquals(2, sourceCalls)
    assertEquals(1, transportCalls)
    assertEquals(1, uploadCalls)
    assertNotNull(uploaded)
    assertFalse(uploaded.toString().contains(PILOT_REFERENCE))
    assertFalse(uploaded.toString().contains(PILOT_RECEIVER_NAME))
    assertNoAuthority(first)
  }

  @Test
  fun `retries the exact staged observation after an uncertain upload without refetching`() {
    val fixture = RuntimeFixture()
    var sourceCalls = 0
    var transportCalls = 0
    val uploaded = mutableListOf<LivePilotSignedObservation>()
    val coordinator =
      fixture.coordinator(
        assignmentSource = LivePilotAssignmentSource {
          sourceCalls += 1
          fixture.signedAssignment
        },
        transport = ProviderTransport {
          transportCalls += 1
          livePilotProviderFound()
        },
        uploader = LivePilotObservationUploader { _, observation ->
          uploaded += observation
          if (uploaded.size == 1) {
            LivePilotUploadResult.Retryable
          } else {
            LivePilotUploadResult.Acknowledged(observation.bodyDigest)
          }
        },
      )

    val first = coordinator.runOnce()
    val queued = fixture.store.nextPending()
    val second = coordinator.runOnce()

    assertEquals(LivePilotRuntimeState.UPLOAD_PENDING, first.state)
    assertEquals("upload_retry_scheduled", first.code)
    assertEquals(LivePilotRuntimeState.READY, second.state)
    assertEquals("observation_acknowledged", second.code)
    assertEquals(1, sourceCalls)
    assertEquals(1, transportCalls)
    assertEquals(2, uploaded.size)
    assertTrue(uploaded[0] === uploaded[1])
    assertEquals(uploaded[0].bodyDigest, uploaded[1].bodyDigest)
    assertEquals(uploaded[0].signature, uploaded[1].signature)
    assertNotNull(queued)
    assertFalse(queued.toString().contains(PILOT_REFERENCE))
    assertFalse(queued.toString().contains(PILOT_RECEIVER_NAME))
    assertFalse(fixture.store.toString().contains(PILOT_REFERENCE))
  }

  @Test
  fun `rejects an unauthenticated assignment before provider contact or queue claim`() {
    val fixture = RuntimeFixture()
    var transportCalls = 0
    var uploadCalls = 0
    val tampered = fixture.signedAssignment.copy(signature = "A".repeat(86))
    val coordinator =
      fixture.coordinator(
        assignmentSource = LivePilotAssignmentSource { tampered },
        transport = ProviderTransport {
          transportCalls += 1
          livePilotProviderFound()
        },
        uploader = LivePilotObservationUploader { _, _ ->
          uploadCalls += 1
          LivePilotUploadResult.Retryable
        },
      )

    val status = coordinator.runOnce()

    assertEquals(LivePilotRuntimeState.ATTENTION, status.state)
    assertEquals("assignment_signature_invalid", status.code)
    assertEquals(0, transportCalls)
    assertEquals(0, uploadCalls)
    assertNoAuthority(status)
  }

  @Test
  fun `turns an unexpected device fetch failure into review-only signed evidence`() {
    val fixture = RuntimeFixture()
    var uploaded: LivePilotSignedObservation? = null
    val coordinator =
      fixture.coordinator(
        transport = ProviderTransport { error("sensitive device failure") },
        uploader = LivePilotObservationUploader { _, observation ->
          uploaded = observation
          LivePilotUploadResult.Acknowledged(observation.bodyDigest)
        },
      )

    val status = coordinator.runOnce()
    val facts = uploaded?.body?.facts as LivePilotReviewRequiredFacts

    assertEquals(LivePilotRuntimeState.READY, status.state)
    assertEquals("review_required", status.lookupOutcome)
    assertEquals("device_error", facts.reviewReason)
    assertFalse(status.toString().contains("sensitive device failure"))
    assertFalse(status.toString().contains(PILOT_REFERENCE))
    assertFalse(status.toString().contains(PILOT_RECEIVER_NAME))
  }

  private fun assertNoAuthority(status: LivePilotRuntimeStatus) {
    assertTrue(status.advisoryEvidenceOnly)
    assertFalse(status.databaseWriteAllowed)
    assertFalse(status.settlementAllowed)
    assertFalse(status.financialActionAllowed)
  }

  private class RuntimeFixture {
    val signer = JvmP256Identity("pilot-server-key-0001")
    val device = JvmP256Identity("pilot-device-key-0001")
    val assignmentBody = livePilotAssignmentBody()
    val signedAssignment = livePilotSignedAssignment(assignmentBody, signer)
    val store = InMemoryLivePilotWorkStore()

    fun coordinator(
      gate: LivePilotRuntimeGate =
        LivePilotRuntimeGate(
          buildEnabled = true,
          providerObservationEnabled = true,
          operatorEnabled = true,
        ),
      identity: P256Identity = device,
      enrollment: LivePilotDeviceEnrollment = livePilotEnrollment(device),
      assignmentSource: LivePilotAssignmentSource =
        LivePilotAssignmentSource { signedAssignment },
      transport: ProviderTransport = ProviderTransport { livePilotProviderFound() },
      uploader: LivePilotObservationUploader =
        LivePilotObservationUploader { _, observation ->
          LivePilotUploadResult.Acknowledged(observation.bodyDigest)
        },
    ): LivePrivatePilotRuntimeCoordinator =
      LivePrivatePilotRuntimeCoordinator(
        gate = gate,
        trustedSigner = livePilotTrustedSigner(signer),
        enrollment = enrollment,
        signerPublicSpkiDer = signer.keyPair.public.encoded,
        identity = identity,
        assignmentSource = assignmentSource,
        transport = transport,
        parser = LivePrivatePilotReceiptParser(),
        uploader = uploader,
        workStore = store,
        clock =
          MillisClock {
            Instant.parse("2026-08-20T18:03:00.000Z").toEpochMilli()
          },
      )
  }
}
