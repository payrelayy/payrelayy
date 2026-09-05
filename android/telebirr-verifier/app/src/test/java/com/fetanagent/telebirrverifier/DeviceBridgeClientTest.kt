package com.fetanagent.telebirrverifier

import java.time.Instant
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceBridgeClientTest {
  @Test
  fun `enrollment client authenticates the server certificate and one-use pairing binding`() {
    val fixture = fixture()
    var observedPath: String? = null
    val exchange =
      DeviceBridgeExchange { path, contentType, body ->
        observedPath = path
        assertEquals(DeviceBridgeProtocol.CONTENT_TYPE, contentType)
        assertTrue(body.toString(Charsets.UTF_8).contains(fixture.pairing.signature))
        DeviceBridgeRawResponse(
          statusCode = 201,
          contentType = DeviceBridgeProtocol.CONTENT_TYPE,
          body = DeviceBridgeJsonCodec.encodePairingResponseForTest(fixture.certificate),
        )
      }
    val enrolled =
      DeviceBridgeEnrollmentClient(
          exchange,
          fixture.server.keyPair.public.encoded,
          MillisClock { instant("2026-09-04T10:00:05.000Z") },
        )
        .enroll(fixture.pairing)
    assertEquals(DeviceBridgeProtocol.PAIRING_PATH, observedPath)
    assertEquals(fixture.certificate, enrolled)
  }

  @Test
  fun `enrollment client retries server failures and rejects client failures`() {
    val fixture = fixture()
    fun client(statusCode: Int) =
      DeviceBridgeEnrollmentClient(
        DeviceBridgeExchange { _, _, _ ->
          DeviceBridgeRawResponse(
            statusCode = statusCode,
            contentType = FixedDeviceBridgeHttpsExchange.ERROR_CONTENT_TYPE,
            body = "{\"code\":\"invalid_request\"}".toByteArray(),
          )
        },
        fixture.server.keyPair.public.encoded,
        MillisClock { instant("2026-09-04T10:00:05.000Z") },
      )

    assertThrows(DeviceBridgeRetryableException::class.java) {
      client(503).enroll(fixture.pairing)
    }
    assertThrows(IllegalArgumentException::class.java) {
      client(401).enroll(fixture.pairing)
    }
  }

  @Test
  fun `authenticated client polls through the injected channel and accepts signed no-work ack`() {
    val fixture = fixture()
    var now = instant("2026-09-04T10:01:00.000Z")
    val material = fixedMaterial("bridge-request-0001", repeatedDigest('5'))
    val expectedRequest = pollRequest(fixture, "bridge-request-0001", repeatedDigest('5'))
    var observedPath: String? = null
    val exchange =
      DeviceBridgeExchange { path, contentType, frame ->
        observedPath = path
        assertEquals(DeviceBridgeProtocol.CONTENT_TYPE, contentType)
        assertTrue(frame.toString(Charsets.UTF_8).contains("\"requestedLeaseSeconds\":120"))
        now = instant("2026-09-04T10:01:01.000Z")
        val response =
          DeviceBridgeCommandResponse(
            acknowledgement =
              signedAcknowledgement(
                acknowledgementBody(expectedRequest),
                fixture.server,
              ),
            assignment = null,
          )
        DeviceBridgeRawResponse(
          statusCode = 200,
          contentType = DeviceBridgeProtocol.CONTENT_TYPE,
          body = DeviceBridgeJsonCodec.encodeCommandResponseForTest(response),
        )
      }
    val client = client(fixture, exchange, material, MillisClock { now })
    assertNull(client.nextAssignment())
    assertEquals(DeviceBridgeProtocol.ASSIGNMENT_POLL_PATH, observedPath)
  }

  @Test
  fun `authenticated client maps signed upload acknowledgement to the runtime idempotency digest`() {
    val fixture = fixture()
    val (authenticated, assignmentSigner, device) =
      authenticateLivePilotAssignment(
        signer = fixture.assignmentSigner,
        device = fixture.device,
      )
    assertEquals(fixture.assignmentSigner.keyId, assignmentSigner.keyId)
    assertEquals(fixture.device.keyId, device.keyId)
    val assignment = livePilotSignedAssignment(authenticated.body, fixture.assignmentSigner)
    val observation =
      LivePilotSignedObservationFactory.create(
        assignment = authenticated,
        facts =
          LivePilotReviewRequiredFacts(
            reviewReason = "provider_unavailable",
            retrievedAt = "2026-08-20T18:03:00.000Z",
          ),
        sourceDocumentDigest = repeatedDigest('8'),
        observedAt = "2026-08-20T18:03:00.000Z",
        identity = fixture.device,
      )
    var now = instant("2026-09-04T10:01:00.000Z")
    val requestId = "bridge-request-0002"
    val nonceDigest = repeatedDigest('9')
    val expectedRequest = uploadRequest(fixture, requestId, nonceDigest, assignment, observation)
    val exchange =
      DeviceBridgeExchange { path, _, frame ->
        assertEquals(DeviceBridgeProtocol.OBSERVATION_UPLOAD_PATH, path)
        val serialized = frame.toString(Charsets.UTF_8)
        assertTrue(serialized.contains(assignment.signature))
        assertTrue(serialized.contains(observation.signature))
        now = instant("2026-09-04T10:01:01.000Z")
        val acknowledgementBody =
          acknowledgementBody(
            expectedRequest,
            outcome = DeviceBridgeAcknowledgementOutcome.ACKNOWLEDGED,
            assignmentBodyDigest = assignment.bodyDigest,
            observationBodyDigest = observation.bodyDigest,
          )
        DeviceBridgeRawResponse(
          statusCode = 200,
          contentType = DeviceBridgeProtocol.CONTENT_TYPE,
          body =
            DeviceBridgeJsonCodec.encodeCommandResponseForTest(
              DeviceBridgeCommandResponse(
                signedAcknowledgement(acknowledgementBody, fixture.server),
                null,
              ),
            ),
        )
      }
    val client =
      client(
        fixture,
        exchange,
        fixedMaterial(requestId, nonceDigest),
        MillisClock { now },
      )
    assertEquals(
      LivePilotUploadResult.Acknowledged(observation.bodyDigest),
      client.upload(assignment, observation),
    )
  }

  @Test
  fun `bad server signature is retryable and never becomes an acknowledgement`() {
    val fixture = fixture()
    var now = instant("2026-09-04T10:01:00.000Z")
    val request = pollRequest(fixture, "bridge-request-0001", repeatedDigest('5'))
    val attacker = JvmP256Identity("bridge-attacker-key-0001")
    val exchange =
      DeviceBridgeExchange { _, _, _ ->
        now = instant("2026-09-04T10:01:01.000Z")
        val body = acknowledgementBody(request)
        DeviceBridgeRawResponse(
          200,
          DeviceBridgeProtocol.CONTENT_TYPE,
          DeviceBridgeJsonCodec.encodeCommandResponseForTest(
            DeviceBridgeCommandResponse(signedAcknowledgement(body, attacker), null),
          ),
        )
      }
    val client =
      client(
        fixture,
        exchange,
        fixedMaterial("bridge-request-0001", repeatedDigest('5')),
        MillisClock { now },
      )
    assertTrue(
      runCatching { client.nextAssignment() }.exceptionOrNull() is IllegalArgumentException,
    )
  }

  @Test
  fun `heartbeat never includes lookup identifiers and verifies signed response`() {
    val fixture = fixture()
    var now = instant("2026-09-04T10:01:00.000Z")
    val payload =
      DeviceBridgeHeartbeatPayload(
        DeviceBridgeRuntimeState.READY,
        "no_assignment",
        "0.2.0-runtime-inert",
      )
    val expectedRequest =
      signedRequest(
        fixture,
        "bridge-request-0003",
        repeatedDigest('a'),
        DeviceBridgeCommand.HEARTBEAT,
        DeviceBridgeCanonical.heartbeatPayloadDigest(payload),
      )
    val exchange =
      DeviceBridgeExchange { _, _, frame ->
        val serialized = frame.toString(Charsets.UTF_8)
        assertTrue(serialized.contains("\"statusCode\":\"no_assignment\""))
        assertTrue(!serialized.contains("PILOT9ABC1234"))
        now = instant("2026-09-04T10:01:01.000Z")
        val body =
          acknowledgementBody(
            expectedRequest,
            outcome = DeviceBridgeAcknowledgementOutcome.ACKNOWLEDGED,
          )
        DeviceBridgeRawResponse(
          200,
          DeviceBridgeProtocol.CONTENT_TYPE,
          DeviceBridgeJsonCodec.encodeCommandResponseForTest(
            DeviceBridgeCommandResponse(signedAcknowledgement(body, fixture.server), null),
          ),
        )
      }
    val client =
      client(
        fixture,
        exchange,
        fixedMaterial("bridge-request-0003", repeatedDigest('a')),
        MillisClock { now },
      )
    assertEquals(
      DeviceBridgeHeartbeatResult.Acknowledged,
      client.heartbeat(LivePilotRuntimeStatus(LivePilotRuntimeState.READY, "no_assignment")),
    )
  }

  private data class Fixture(
    val device: JvmP256Identity,
    val server: JvmP256Identity,
    val assignmentSigner: JvmP256Identity,
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
        receiverProfileDigest = repeatedDigest('1'),
        receiverConfigurationDigest = repeatedDigest('0'),
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
          encode(
            server.signP1363(
              DeviceBridgeCanonical.enrollmentCertificateSignatureBytes(
                certificateBody,
                server.keyId,
              ),
            ),
          ),
      )
    return Fixture(device, server, assignmentSigner, pairing, certificate)
  }

  private fun client(
    fixture: Fixture,
    exchange: DeviceBridgeExchange,
    material: DeviceBridgeRequestMaterialSource,
    clock: MillisClock,
  ) =
    AuthenticatedDeviceBridgeClient(
      certificate = fixture.certificate,
      trustedServerSpkiDer = fixture.server.keyPair.public.encoded,
      identity = fixture.device,
      exchange = exchange,
      requestMaterial = material,
      appVersion = "0.2.0-runtime-inert",
      clock = clock,
    )

  private fun pollRequest(
    fixture: Fixture,
    requestId: String,
    nonceDigest: String,
  ): SignedDeviceBridgeRequest {
    val payload = DeviceBridgeAssignmentPollPayload(120)
    return signedRequest(
      fixture,
      requestId,
      nonceDigest,
      DeviceBridgeCommand.ASSIGNMENT_POLL,
      DeviceBridgeCanonical.assignmentPollPayloadDigest(payload),
    )
  }

  private fun uploadRequest(
    fixture: Fixture,
    requestId: String,
    nonceDigest: String,
    assignment: LivePilotSignedAssignment,
    observation: LivePilotSignedObservation,
  ): SignedDeviceBridgeRequest =
    signedRequest(
      fixture,
      requestId,
      nonceDigest,
      DeviceBridgeCommand.OBSERVATION_UPLOAD,
      DeviceBridgeCanonical.observationUploadPayloadDigest(
        DeviceBridgeObservationUploadPayload(assignment, observation),
      ),
    )

  private fun signedRequest(
    fixture: Fixture,
    requestId: String,
    nonceDigest: String,
    command: DeviceBridgeCommand,
    payloadDigest: String,
  ): SignedDeviceBridgeRequest =
    DeviceBridgeSignedFactory.request(
      DeviceBridgeRequestBody(
        requestId = requestId,
        enrollmentId = fixture.certificate.body.enrollmentId,
        deviceId = fixture.certificate.body.deviceId,
        keyId = fixture.certificate.body.keyId,
        command = command,
        payloadDigest = payloadDigest,
        nonceDigest = nonceDigest,
        issuedAt = "2026-09-04T10:01:00.000Z",
        expiresAt = "2026-09-04T10:02:00.000Z",
      ),
      fixture.device,
    )

  private fun acknowledgementBody(
    request: SignedDeviceBridgeRequest,
    outcome: DeviceBridgeAcknowledgementOutcome =
      DeviceBridgeAcknowledgementOutcome.NO_ASSIGNMENT,
    assignmentBodyDigest: String? = null,
    observationBodyDigest: String? = null,
  ) =
    DeviceBridgeAcknowledgementBody(
      acknowledgementId = "bridge-acknowledgement-0001",
      requestId = request.body.requestId,
      enrollmentId = request.body.enrollmentId,
      deviceId = request.body.deviceId,
      keyId = request.body.keyId,
      command = request.body.command,
      requestBodyDigest = request.bodyDigest,
      requestPayloadDigest = request.body.payloadDigest,
      outcome = outcome,
      assignmentBodyDigest = assignmentBodyDigest,
      observationBodyDigest = observationBodyDigest,
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
        encode(
          server.signP1363(
            DeviceBridgeCanonical.acknowledgementSignatureBytes(body, server.keyId),
          ),
        ),
    )

  private fun fixedMaterial(
    requestId: String,
    nonceDigest: String,
  ): DeviceBridgeRequestMaterialSource =
    object : DeviceBridgeRequestMaterialSource {
      override fun nextRequestId(): String = requestId

      override fun nextNonceDigest(): String = nonceDigest
    }

  private fun instant(value: String): Long = Instant.parse(value).toEpochMilli()

  private fun encode(value: ByteArray): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(value)
}
