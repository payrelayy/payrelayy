package com.fetanagent.telebirrverifier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePrivatePilotProtocolTest {
  @Test
  fun `matches TypeScript canonical transcript vectors exactly`() {
    val assignment = livePilotAssignmentBody()
    val facts = livePilotFoundFacts()
    val authenticated = AuthenticatedLivePilotAssignment(assignment)
    val device = JvmP256Identity("pilot-device-key-0001")
    val observation =
      LivePilotSignedObservationFactory.create(
        assignment = authenticated,
        facts = facts,
        sourceDocumentDigest = repeatedDigest('5'),
        observedAt = "2026-08-20T18:03:00.000Z",
        identity = device,
      )

    assertEquals(2021, LivePilotCanonicalTranscripts.assignmentBodyBytes(assignment).size)
    assertEquals(
      "sha256:21dc18df68841c6bb4ebc27d19d3ebc52c2c6649689222a846a6f34e7249489d",
      LivePilotCanonicalTranscripts.assignmentBodyDigest(assignment),
    )
    assertEquals(507, LivePilotCanonicalTranscripts.assignmentSignatureBytes(assignment).size)
    assertEquals(
      "sha256:6462f519dfaa861b7090dd03677fa6ca010be53a7b8f94e893623fe3a247baae",
      LivePilotCanonicalTranscripts.receiptFactsDigest(facts),
    )
    assertEquals(2905, LivePilotCanonicalTranscripts.observationBodyBytes(observation.body).size)
    assertEquals(
      "sha256:ca5b5995c472c96fa068617d8b9302cb93342f2854838c70376869d3598357aa",
      LivePilotCanonicalTranscripts.observationBodyDigest(observation.body),
    )
    assertEquals(509, LivePilotCanonicalTranscripts.observationSignatureBytes(observation.body).size)
  }

  @Test
  fun `verifies server assignment signature before exposing sensitive lookup material`() {
    val signer = JvmP256Identity("pilot-server-key-0001")
    val device = JvmP256Identity("pilot-device-key-0001")
    val body = livePilotAssignmentBody()
    val assessment =
      LivePilotAssignmentVerifier.verify(
        signer = livePilotTrustedSigner(signer),
        enrollment = livePilotEnrollment(device),
        signedAssignment = livePilotSignedAssignment(body, signer),
        signerPublicSpkiDer = signer.keyPair.public.encoded,
        devicePublicMaterial = device.publicMaterial(),
        assessedAt = "2026-08-20T18:03:00.000Z",
      )

    assertEquals("would_open_assignment", assessment.disposition)
    assertEquals("signed_assignment_verified", assessment.reasonCode)
    assertEquals("AuthenticatedLivePilotAssignment(<redacted>)", assessment.authenticatedAssignment.toString())
    assertTrue(assessment.advisoryEvidenceOnly)
    assertAllCapabilitiesFalse(assessment.capabilities)
  }

  @Test
  fun `normalizes receiver names and binds raw reference identically to server`() {
    assertEquals("pilot receiver", LivePilotNameNormalizer.normalize("  PILOT\tReceiver  "))
    assertEquals("ፓይለት ተቀባይ", LivePilotNameNormalizer.normalize("ፓይለት  ተቀባይ"))
    assertNull(LivePilotNameNormalizer.normalize("x\u0000y"))
    assertEquals(
      LivePilotCanonicalTranscripts.receiverNameDigest("PILOT RECEIVER"),
      LivePilotCanonicalTranscripts.receiverNameDigest(PILOT_RECEIVER_NAME),
    )
    assertNotEquals(
      LivePilotCanonicalTranscripts.referenceBindingDigest(
        PILOT_REFERENCE,
        pilotFingerprint('2'),
      ),
      LivePilotCanonicalTranscripts.referenceBindingDigest(
        "PILOT9ABC9999",
        pilotFingerprint('2'),
      ),
    )
  }

  @Test
  fun `fails assignment mutation key mutation and signature mutation closed`() {
    val signer = JvmP256Identity("pilot-server-key-0001")
    val otherSigner = JvmP256Identity("pilot-server-key-0002")
    val device = JvmP256Identity("pilot-device-key-0001")
    val otherDevice = JvmP256Identity("pilot-device-key-0002")
    val baseline = livePilotSignedAssignment(livePilotAssignmentBody(), signer)
    val changedBody = livePilotAssignmentBody(rawReference = "PILOT9ABC9999")
    val changedWithStaleSignature =
      baseline.copy(
        body = changedBody,
        bodyDigest = LivePilotCanonicalTranscripts.assignmentBodyDigest(changedBody),
      )
    val badSignature = baseline.copy(signature = "A".repeat(86))

    val results =
      listOf(
        LivePilotAssignmentVerifier.verify(
          livePilotTrustedSigner(signer),
          livePilotEnrollment(device),
          changedWithStaleSignature,
          signer.keyPair.public.encoded,
          device.publicMaterial(),
          "2026-08-20T18:03:00.000Z",
        ),
        LivePilotAssignmentVerifier.verify(
          livePilotTrustedSigner(signer),
          livePilotEnrollment(device),
          baseline,
          otherSigner.keyPair.public.encoded,
          device.publicMaterial(),
          "2026-08-20T18:03:00.000Z",
        ),
        LivePilotAssignmentVerifier.verify(
          livePilotTrustedSigner(signer),
          livePilotEnrollment(device),
          badSignature,
          signer.keyPair.public.encoded,
          device.publicMaterial(),
          "2026-08-20T18:03:00.000Z",
        ),
        LivePilotAssignmentVerifier.verify(
          livePilotTrustedSigner(signer),
          livePilotEnrollment(device),
          baseline,
          signer.keyPair.public.encoded,
          otherDevice.publicMaterial(),
          "2026-08-20T18:03:00.000Z",
        ),
      )

    assertEquals(
      listOf(
        "assignment_signature_invalid",
        "assignment_signer_key_mismatch",
        "assignment_signature_invalid",
        "device_key_mismatch",
      ),
      results.map { it.reasonCode },
    )
    results.forEach {
      assertEquals("would_review", it.disposition)
      assertNull(it.authenticatedAssignment)
      assertAllCapabilitiesFalse(it.capabilities)
    }
  }

  @Test
  fun `fails enrollment pilot and receiver bindings closed`() {
    val signer = JvmP256Identity("pilot-server-key-0001")
    val device = JvmP256Identity("pilot-device-key-0001")
    val signed = livePilotSignedAssignment(livePilotAssignmentBody(), signer)
    val enrollment = livePilotEnrollment(device)
    val mutations =
      listOf(
        enrollment.copy(deviceId = "pilot-device-0002"),
        enrollment.copy(keyId = "pilot-device-key-0002"),
        enrollment.copy(pilotRevisionId = "pilot-revision-0002"),
        enrollment.copy(receiverRevisionId = "pilot-receiver-revision-0002"),
        enrollment.copy(receiverProfileId = "pilot-receiver-profile-0002"),
        enrollment.copy(receiverProfileDigest = repeatedDigest('8')),
        enrollment.copy(receiverConfigurationDigest = repeatedDigest('7')),
      )

    mutations.forEach { mutated ->
      val result =
        LivePilotAssignmentVerifier.verify(
          livePilotTrustedSigner(signer),
          mutated,
          signed,
          signer.keyPair.public.encoded,
          device.publicMaterial(),
          "2026-08-20T18:03:00.000Z",
        )
      assertEquals("would_review", result.disposition)
      assertEquals("binding_mismatch", result.reasonCode)
      assertNull(result.authenticatedAssignment)
    }
  }

  @Test
  fun `fails revoked expired and exact time boundaries closed`() {
    val signer = JvmP256Identity("pilot-server-key-0001")
    val device = JvmP256Identity("pilot-device-key-0001")
    val signed = livePilotSignedAssignment(livePilotAssignmentBody(), signer)
    val trusted = livePilotTrustedSigner(signer)
    val enrollment = livePilotEnrollment(device)
    val cases =
      listOf(
        Triple(trusted.copy(state = "revoked"), enrollment, "assignment_signer_revoked"),
        Triple(trusted, enrollment.copy(state = "revoked"), "device_revoked"),
        Triple(
          trusted.copy(validUntil = "2026-08-20T18:03:00.000Z"),
          enrollment,
          "assignment_signer_expired",
        ),
        Triple(
          trusted,
          enrollment.copy(validUntil = "2026-08-20T18:03:00.000Z"),
          "device_enrollment_expired",
        ),
        Triple(
          trusted.copy(validFrom = "2026-08-20T18:02:00.001Z"),
          enrollment,
          "assignment_signer_expired",
        ),
        Triple(
          trusted,
          enrollment.copy(validFrom = "2026-08-20T18:02:00.001Z"),
          "device_enrollment_expired",
        ),
      )
    cases.forEach { (selectedSigner, selectedEnrollment, reason) ->
      assertEquals(
        reason,
        LivePilotAssignmentVerifier.verify(
            selectedSigner,
            selectedEnrollment,
            signed,
            signer.keyPair.public.encoded,
            device.publicMaterial(),
            "2026-08-20T18:03:00.000Z",
          )
          .reasonCode,
      )
    }
    assertEquals(
      "assignment_expired",
      LivePilotAssignmentVerifier.verify(
          trusted,
          enrollment,
          signed,
          signer.keyPair.public.encoded,
          device.publicMaterial(),
          "2026-08-20T18:04:00.000Z",
        )
        .reasonCode,
    )
  }

  @Test
  fun `signed observation omits raw reference and raw receiver name and grants no authority`() {
    val (authenticated, _, device) = authenticateLivePilotAssignment()
    val observation =
      LivePilotSignedObservationFactory.create(
        assignment = authenticated,
        facts = livePilotFoundFacts(),
        sourceDocumentDigest = repeatedDigest('5'),
        observedAt = "2026-08-20T18:03:00.000Z",
        identity = device,
      )
    val fields = observation.body.javaClass.declaredFields.map { it.name }.toSet()
    assertFalse(fields.contains("rawReference"))
    assertFalse(fields.contains("expectedReceiverNameNormalized"))
    assertFalse(observation.toString().contains(PILOT_REFERENCE))
    assertFalse(observation.toString().contains(PILOT_RECEIVER_NAME))
    assertAllCapabilitiesFalse(LivePrivatePilotProtocol.CAPABILITIES)
    assertEquals(86, observation.signature.length)
  }

  private fun assertAllCapabilitiesFalse(capabilities: LivePilotDisabledCapabilities) {
    assertFalse(capabilities.transportAllowed)
    assertFalse(capabilities.networkAllowed)
    assertFalse(capabilities.providerInteractionAllowed)
    assertFalse(capabilities.databaseReadAllowed)
    assertFalse(capabilities.databaseWriteAllowed)
    assertFalse(capabilities.persistenceAllowed)
    assertFalse(capabilities.claimAllowed)
    assertFalse(capabilities.settlementAllowed)
    assertFalse(capabilities.enqueueAllowed)
    assertFalse(capabilities.executionAllowed)
    assertFalse(capabilities.financialActionAllowed)
  }
}
