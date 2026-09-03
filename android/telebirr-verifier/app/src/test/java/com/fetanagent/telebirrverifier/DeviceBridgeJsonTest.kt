package com.fetanagent.telebirrverifier

import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceBridgeJsonTest {
  @Test
  fun `strict certificate response codec round trips every flat safety binding`() {
    val fixture = fixture()
    val encoded = DeviceBridgeJsonCodec.encodePairingResponseForTest(fixture.certificate)
    val decoded = DeviceBridgeJsonCodec.decodePairingResponse(encoded)
    assertEquals(fixture.certificate, decoded)
    assertTrue(
      DeviceBridgeVerifier.verifyCertificate(
        requireNotNull(decoded),
        fixture.server.keyPair.public.encoded,
      ),
    )
    val text = encoded.toString(Charsets.UTF_8)
    assertTrue(text.contains("\"databaseAccessAllowed\":false"))
    assertFalse(text.contains("\"safety\""))
  }

  @Test
  fun `strict command response codec binds assignment presence to acknowledgement outcome`() {
    val fixture = fixture()
    val request = pollRequest(fixture.device)
    val body = acknowledgementBody(request)
    val acknowledgement = signedAcknowledgement(body, fixture.server)
    val response = DeviceBridgeCommandResponse(acknowledgement, null)
    val encoded = DeviceBridgeJsonCodec.encodeCommandResponseForTest(response)
    assertEquals(response, DeviceBridgeJsonCodec.decodeCommandResponse(encoded))
    assertTrue(
      DeviceBridgeVerifier.verifyAcknowledgement(
        acknowledgement,
        request,
        fixture.server.keyPair.public.encoded,
        "2026-09-04T10:01:30.000Z",
      ),
    )
  }

  @Test
  fun `pairing and poll encoders produce deterministic bounded UTF-8 frames`() {
    val fixture = fixture()
    val pairingBytes = DeviceBridgeJsonCodec.encodePairingRequest(fixture.pairing)
    assertArrayEquals(pairingBytes, DeviceBridgeJsonCodec.encodePairingRequest(fixture.pairing))
    assertTrue(pairingBytes.size < 8_192)

    val payload = DeviceBridgeAssignmentPollPayload(120)
    val request = pollRequest(fixture.device)
    val frame = DeviceBridgeJsonCodec.encodeAssignmentPollFrame(request, payload)
    val text = frame.toString(Charsets.UTF_8)
    assertTrue(text.startsWith("{\"request\":"))
    assertTrue(text.contains("\"requestedLeaseSeconds\":120"))
    assertFalse(text.contains("service_role"))
  }

  @Test
  fun `upload encoder serializes the exact already-signed assignment and observation`() {
    val (_, assignmentSigner, device) = authenticateLivePilotAssignment()
    val authenticated = authenticateLivePilotAssignment(signer = assignmentSigner, device = device).first
    val assignment = livePilotSignedAssignment(authenticated.body, assignmentSigner)
    val facts =
      LivePilotReviewRequiredFacts(
        reviewReason = "provider_unavailable",
        retrievedAt = "2026-08-20T18:03:00.000Z",
      )
    val observation =
      LivePilotSignedObservationFactory.create(
        assignment = authenticated,
        facts = facts,
        sourceDocumentDigest = repeatedDigest('8'),
        observedAt = "2026-08-20T18:03:00.000Z",
        identity = device,
      )
    val payload = DeviceBridgeObservationUploadPayload(assignment, observation)
    val request =
      DeviceBridgeSignedFactory.request(
        DeviceBridgeRequestBody(
          requestId = "bridge-request-0002",
          enrollmentId = "pilot-enrollment-0001",
          deviceId = "pilot-device-0001",
          keyId = device.keyId,
          command = DeviceBridgeCommand.OBSERVATION_UPLOAD,
          payloadDigest = DeviceBridgeCanonical.observationUploadPayloadDigest(payload),
          nonceDigest = repeatedDigest('9'),
          issuedAt = "2026-09-04T10:01:00.000Z",
          expiresAt = "2026-09-04T10:03:00.000Z",
        ),
        device,
      )
    val frame = DeviceBridgeJsonCodec.encodeObservationUploadFrame(request, payload)
    val text = frame.toString(Charsets.UTF_8)
    assertTrue(text.contains("\"signedAssignment\""))
    assertTrue(text.contains("\"signedObservation\""))
    assertTrue(text.contains(assignment.signature))
    assertTrue(text.contains(observation.signature))
    assertFalse(text.contains("\"databaseAccessAllowed\":true"))
  }

  @Test
  fun `decoder rejects duplicate keys extras malformed UTF-8 and non-integer numbers`() {
    val fixture = fixture()
    val valid =
      DeviceBridgeJsonCodec.encodePairingResponseForTest(fixture.certificate)
        .toString(Charsets.UTF_8)
    val duplicate = valid.replaceFirst("{", "{\"certificate\":null,")
    assertNull(DeviceBridgeJsonCodec.decodePairingResponse(duplicate.toByteArray()))
    val extra = valid.dropLast(1) + ",\"unexpected\":true}"
    assertNull(DeviceBridgeJsonCodec.decodePairingResponse(extra.toByteArray()))
    assertNull(DeviceBridgeJsonCodec.decodePairingResponse(byteArrayOf(0xc3.toByte(), 0x28)))
    val nonInteger = valid.replaceFirst("\"contractVersion\":1", "\"contractVersion\":1.0")
    assertNull(DeviceBridgeJsonCodec.decodePairingResponse(nonInteger.toByteArray()))
  }

  @Test
  fun `decoder rejects acknowledgement capability escalation before use`() {
    val fixture = fixture()
    val request = pollRequest(fixture.device)
    val response =
      DeviceBridgeCommandResponse(
        signedAcknowledgement(acknowledgementBody(request), fixture.server),
        null,
      )
    val valid =
      DeviceBridgeJsonCodec.encodeCommandResponseForTest(response).toString(Charsets.UTF_8)
    val escalated = valid.replaceFirst(
      "\"financialActionAllowed\":false",
      "\"financialActionAllowed\":true",
    )
    assertNull(DeviceBridgeJsonCodec.decodeCommandResponse(escalated.toByteArray()))
  }

  private data class Fixture(
    val device: JvmP256Identity,
    val server: JvmP256Identity,
    val pairing: SignedDeviceBridgePairingRequest,
    val certificate: SignedDeviceBridgeEnrollmentCertificate,
  )

  private fun fixture(): Fixture {
    val device = JvmP256Identity("pilot-device-key-0001")
    val server = JvmP256Identity("bridge-server-key-0001")
    val assignmentSigner = JvmP256Identity("pilot-server-key-0001")
    val public = device.publicMaterial()
    val pairing =
      DeviceBridgeSignedFactory.pairing(
        DeviceBridgePairingBody(
          pairingId = "pairing-request-0001",
          pairingNonceDigest = repeatedDigest('1'),
          deviceId = "pilot-device-0001",
          keyId = device.keyId,
          devicePublicKeySpki = public.publicKeySpkiBase64Url,
          devicePublicKeySpkiSha256 = public.publicKeySpkiSha256,
          appVersion = "0.2.0-runtime-inert",
          issuedAt = "2026-09-04T10:00:00.000Z",
          expiresAt = "2026-09-04T10:10:00.000Z",
        ),
        device,
      )
    val certificateBody =
      DeviceBridgeEnrollmentCertificateBody(
        enrollmentId = "pilot-enrollment-0001",
        pairingId = pairing.body.pairingId,
        pairingRequestBodyDigest = pairing.bodyDigest,
        pairingNonceDigest = pairing.body.pairingNonceDigest,
        deviceId = pairing.body.deviceId,
        keyId = pairing.body.keyId,
        devicePublicKeySpki = pairing.body.devicePublicKeySpki,
        devicePublicKeySpkiSha256 = pairing.body.devicePublicKeySpkiSha256,
        minimumAppVersion = "0.2.0-runtime-inert",
        pilotRevisionId = "pilot-revision-0001",
        receiverRevisionId = "pilot-receiver-revision-0001",
        receiverProfileId = "pilot-receiver-profile-0001",
        receiverProfileDigest = repeatedDigest('2'),
        receiverConfigurationDigest = repeatedDigest('3'),
        assignmentSignerKeyId = assignmentSigner.keyId,
        assignmentSignerPublicKeySpkiSha256 =
          assignmentSigner.publicMaterial().publicKeySpkiSha256,
        state = "active",
        issuedAt = "2026-09-04T10:00:05.000Z",
        validFrom = "2026-09-04T10:00:05.000Z",
        validUntil = "2026-10-04T10:00:05.000Z",
      )
    val certificate =
      SignedDeviceBridgeEnrollmentCertificate(
        bodyDigest = DeviceBridgeCanonical.enrollmentCertificateBodyDigest(certificateBody),
        signerKeyId = server.keyId,
        body = certificateBody,
        signature =
          Base64.getUrlEncoder().withoutPadding().encodeToString(
            server.signP1363(
              DeviceBridgeCanonical.enrollmentCertificateSignatureBytes(
                certificateBody,
                server.keyId,
              ),
            ),
          ),
      )
    return Fixture(device, server, pairing, certificate)
  }

  private fun pollRequest(device: JvmP256Identity): SignedDeviceBridgeRequest {
    val payload = DeviceBridgeAssignmentPollPayload(120)
    return DeviceBridgeSignedFactory.request(
      DeviceBridgeRequestBody(
        requestId = "bridge-request-0001",
        enrollmentId = "pilot-enrollment-0001",
        deviceId = "pilot-device-0001",
        keyId = device.keyId,
        command = DeviceBridgeCommand.ASSIGNMENT_POLL,
        payloadDigest = DeviceBridgeCanonical.assignmentPollPayloadDigest(payload),
        nonceDigest = repeatedDigest('5'),
        issuedAt = "2026-09-04T10:01:00.000Z",
        expiresAt = "2026-09-04T10:03:00.000Z",
      ),
      device,
    )
  }

  private fun acknowledgementBody(request: SignedDeviceBridgeRequest) =
    DeviceBridgeAcknowledgementBody(
      acknowledgementId = "bridge-acknowledgement-0001",
      requestId = request.body.requestId,
      enrollmentId = request.body.enrollmentId,
      deviceId = request.body.deviceId,
      keyId = request.body.keyId,
      command = request.body.command,
      requestBodyDigest = request.bodyDigest,
      requestPayloadDigest = request.body.payloadDigest,
      outcome = DeviceBridgeAcknowledgementOutcome.NO_ASSIGNMENT,
      assignmentBodyDigest = null,
      observationBodyDigest = null,
      reasonCode = null,
      issuedAt = "2026-09-04T10:01:01.000Z",
      expiresAt = request.body.expiresAt,
    )

  private fun signedAcknowledgement(
    body: DeviceBridgeAcknowledgementBody,
    server: JvmP256Identity,
  ) =
    SignedDeviceBridgeAcknowledgement(
      bodyDigest = DeviceBridgeCanonical.acknowledgementBodyDigest(body),
      signerKeyId = server.keyId,
      body = body,
      signature =
        Base64.getUrlEncoder().withoutPadding().encodeToString(
          server.signP1363(
            DeviceBridgeCanonical.acknowledgementSignatureBytes(body, server.keyId),
          ),
        ),
    )
}
