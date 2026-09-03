package com.fetanagent.telebirrverifier

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceBridgeProtocolTest {
  @Test
  fun `pairing certificate request and acknowledgement authenticate end to end`() {
    val device = JvmP256Identity("pilot-device-key-0001")
    val server = JvmP256Identity("bridge-server-key-0001")
    val assignmentSigner = JvmP256Identity("pilot-server-key-0001")
    val pairingBody = pairingBody(device)
    val pairing = DeviceBridgeSignedFactory.pairing(pairingBody, device)
    assertTrue(DeviceBridgeVerifier.verifyPairing(pairing))

    val certificateBody = certificateBody(pairing, assignmentSigner.publicMaterial().publicKeySpkiSha256)
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
    assertTrue(DeviceBridgeVerifier.verifyCertificate(certificate, server.keyPair.public.encoded))
    assertTrue(DeviceBridgeVerifier.certificateMatchesPairing(certificate, pairing))
    assertEquals(certificateBody.livePilotEnrollment().deviceId, certificateBody.deviceId)

    val payload = DeviceBridgeAssignmentPollPayload(120)
    val requestBody =
      DeviceBridgeRequestBody(
        requestId = "bridge-request-0001",
        enrollmentId = certificateBody.enrollmentId,
        deviceId = certificateBody.deviceId,
        keyId = certificateBody.keyId,
        command = DeviceBridgeCommand.ASSIGNMENT_POLL,
        payloadDigest = DeviceBridgeCanonical.assignmentPollPayloadDigest(payload),
        nonceDigest = repeatedDigest('5'),
        issuedAt = "2026-09-04T10:01:00.000Z",
        expiresAt = "2026-09-04T10:03:00.000Z",
      )
    val request = DeviceBridgeSignedFactory.request(requestBody, device)
    val acknowledgementBody = acknowledgementBody(request)
    val acknowledgement =
      SignedDeviceBridgeAcknowledgement(
        bodyDigest = DeviceBridgeCanonical.acknowledgementBodyDigest(acknowledgementBody),
        signerKeyId = server.keyId,
        body = acknowledgementBody,
        signature =
          encode(
            server.signP1363(
              DeviceBridgeCanonical.acknowledgementSignatureBytes(
                acknowledgementBody,
                server.keyId,
              ),
            ),
          ),
      )
    assertTrue(
      DeviceBridgeVerifier.verifyAcknowledgement(
        acknowledgement,
        request,
        server.keyPair.public.encoded,
        "2026-09-04T10:01:30.000Z",
      ),
    )
    assertFalse(
      DeviceBridgeVerifier.verifyAcknowledgement(
        acknowledgement,
        request,
        server.keyPair.public.encoded,
        "2026-09-04T10:03:00.000Z",
      ),
    )
  }

  @Test
  fun `canonical vectors match the TypeScript server`() {
    val pairing = fixedPairingBody()
    val certificate =
      DeviceBridgeEnrollmentCertificateBody(
        enrollmentId = "pilot-enrollment-0001",
        pairingId = pairing.pairingId,
        pairingRequestBodyDigest = DeviceBridgeCanonical.pairingBodyDigest(pairing),
        pairingNonceDigest = pairing.pairingNonceDigest,
        deviceId = pairing.deviceId,
        keyId = pairing.keyId,
        devicePublicKeySpki = pairing.devicePublicKeySpki,
        devicePublicKeySpkiSha256 = pairing.devicePublicKeySpkiSha256,
        minimumAppVersion = "0.2.0-runtime-inert",
        pilotRevisionId = "pilot-revision-0001",
        receiverRevisionId = "pilot-receiver-revision-0001",
        receiverProfileId = "pilot-receiver-profile-0001",
        receiverProfileDigest = repeatedDigest('2'),
        receiverConfigurationDigest = repeatedDigest('3'),
        assignmentSignerKeyId = "pilot-server-key-0001",
        assignmentSignerPublicKeySpkiSha256 = repeatedDigest('4'),
        state = "active",
        issuedAt = "2026-09-04T10:00:05.000Z",
        validFrom = "2026-09-04T10:00:05.000Z",
        validUntil = "2026-10-04T10:00:05.000Z",
      )
    val payload = DeviceBridgeAssignmentPollPayload(120)
    val request =
      DeviceBridgeRequestBody(
        requestId = "bridge-request-0001",
        enrollmentId = "pilot-enrollment-0001",
        deviceId = "pilot-device-0001",
        keyId = "pilot-device-key-0001",
        command = DeviceBridgeCommand.ASSIGNMENT_POLL,
        payloadDigest = DeviceBridgeCanonical.assignmentPollPayloadDigest(payload),
        nonceDigest = repeatedDigest('5'),
        issuedAt = "2026-09-04T10:01:00.000Z",
        expiresAt = "2026-09-04T10:03:00.000Z",
      )
    val requestDigest = DeviceBridgeCanonical.requestBodyDigest(request)
    val acknowledgement =
      DeviceBridgeAcknowledgementBody(
        acknowledgementId = "bridge-acknowledgement-0001",
        requestId = request.requestId,
        enrollmentId = request.enrollmentId,
        deviceId = request.deviceId,
        keyId = request.keyId,
        command = request.command,
        requestBodyDigest = requestDigest,
        requestPayloadDigest = request.payloadDigest,
        outcome = DeviceBridgeAcknowledgementOutcome.NO_ASSIGNMENT,
        assignmentBodyDigest = null,
        observationBodyDigest = null,
        reasonCode = null,
        issuedAt = "2026-09-04T10:01:01.000Z",
        expiresAt = "2026-09-04T10:03:00.000Z",
      )

    assertEquals(1313, DeviceBridgeCanonical.pairingBodyBytes(pairing).size)
    assertEquals(
      "sha256:47ae515d50b403a3d37f143f9905472437748053c22f7c2e3d1de2c15d0fc1dc",
      DeviceBridgeCanonical.pairingBodyDigest(pairing),
    )
    assertEquals(536, DeviceBridgeCanonical.pairingSignatureBytes(pairing).size)
    assertEquals(2144, DeviceBridgeCanonical.enrollmentCertificateBodyBytes(certificate).size)
    assertEquals(
      "sha256:ba2a812fb9c6e7b9e24d7b18df6c19e1380fc3d112f72683c2c2aa4e15c71ff2",
      DeviceBridgeCanonical.enrollmentCertificateBodyDigest(certificate),
    )
    assertEquals(
      562,
      DeviceBridgeCanonical.enrollmentCertificateSignatureBytes(
          certificate,
          "bridge-server-key-0001",
        )
        .size,
    )
    assertEquals(
      "sha256:8b499950f7f43a8d382996ac279aca9bc9b64a0e5187439bf84bbc713d46cb52",
      request.payloadDigest,
    )
    assertEquals(1155, DeviceBridgeCanonical.requestBodyBytes(request).size)
    assertEquals(
      "sha256:5a6b6085adf51694fd54acc7239e90d92cf3fe00bd2c9bbc51ffd3c59d0b65aa",
      requestDigest,
    )
    assertEquals(536, DeviceBridgeCanonical.requestSignatureBytes(request).size)
    assertEquals(1271, DeviceBridgeCanonical.acknowledgementBodyBytes(acknowledgement).size)
    assertEquals(
      "sha256:dac488e59d926e99660d622cfe9f6d00464b52e8c8454695216687a1929369b3",
      DeviceBridgeCanonical.acknowledgementBodyDigest(acknowledgement),
    )
    assertEquals(
      559,
      DeviceBridgeCanonical.acknowledgementSignatureBytes(
          acknowledgement,
          "bridge-server-key-0001",
        )
        .size,
    )
  }

  @Test
  fun `unsafe capability and diagnostic values are unrepresentable`() {
    assertTrue(
      runCatching { DeviceBridgeSafety(financialActionAllowed = true) }.exceptionOrNull()
        is IllegalArgumentException,
    )
    assertTrue(
      runCatching {
          DeviceBridgeHeartbeatPayload(
            runtimeState = DeviceBridgeRuntimeState.READY,
            statusCode = "raw reference PILOT9ABC1234",
            appVersion = "0.2.0-runtime-inert",
          )
        }
        .exceptionOrNull() is IllegalArgumentException,
    )
    assertTrue(
      runCatching {
          DeviceBridgeAcknowledgementBody(
            acknowledgementId = "bridge-acknowledgement-0001",
            requestId = "bridge-request-0001",
            enrollmentId = "pilot-enrollment-0001",
            deviceId = "pilot-device-0001",
            keyId = "pilot-device-key-0001",
            command = DeviceBridgeCommand.ASSIGNMENT_POLL,
            requestBodyDigest = repeatedDigest('1'),
            requestPayloadDigest = repeatedDigest('2'),
            outcome = DeviceBridgeAcknowledgementOutcome.ACKNOWLEDGED,
            assignmentBodyDigest = null,
            observationBodyDigest = null,
            reasonCode = null,
            issuedAt = "2026-09-04T10:01:01.000Z",
            expiresAt = "2026-09-04T10:03:00.000Z",
          )
        }
        .exceptionOrNull() is IllegalArgumentException,
    )
  }

  @Test
  fun `string projections redact enrollment and payload material`() {
    val fixed = fixedPairingBody()
    assertFalse(fixed.toString().contains(fixed.devicePublicKeySpki))
    val response =
      DeviceBridgeRawResponse(
        statusCode = 200,
        contentType = DeviceBridgeProtocol.CONTENT_TYPE,
        body = "secret-body".toByteArray(),
      )
    assertFalse(response.toString().contains("secret-body"))
  }

  private fun pairingBody(identity: JvmP256Identity): DeviceBridgePairingBody {
    val public = identity.publicMaterial()
    return DeviceBridgePairingBody(
      pairingId = "pairing-request-0001",
      pairingNonceDigest = repeatedDigest('1'),
      deviceId = "pilot-device-0001",
      keyId = identity.keyId,
      devicePublicKeySpki = public.publicKeySpkiBase64Url,
      devicePublicKeySpkiSha256 = public.publicKeySpkiSha256,
      appVersion = "0.2.0-runtime-inert",
      issuedAt = "2026-09-04T10:00:00.000Z",
      expiresAt = "2026-09-04T10:10:00.000Z",
    )
  }

  private fun fixedPairingBody(): DeviceBridgePairingBody =
    DeviceBridgePairingBody(
      pairingId = "pairing-request-0001",
      pairingNonceDigest = repeatedDigest('1'),
      deviceId = "pilot-device-0001",
      keyId = "pilot-device-key-0001",
      devicePublicKeySpki =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZl_5JsOZvoSviWoLO7NLMkWIxu4s2lmHNEbAY_-WhY6CGVICyKcxwVUSpWve1CrjjNY79QYUfCoUgGxQM4AhMg",
      devicePublicKeySpkiSha256 =
        "sha256:a8a76e4864c698c989b138cb1e232a029f49d9b09681e6d61eb644fc44d1809e",
      appVersion = "0.2.0-runtime-inert",
      issuedAt = "2026-09-04T10:00:00.000Z",
      expiresAt = "2026-09-04T10:10:00.000Z",
    )

  private fun certificateBody(
    pairing: SignedDeviceBridgePairingRequest,
    assignmentSignerDigest: String,
  ): DeviceBridgeEnrollmentCertificateBody =
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
      assignmentSignerKeyId = "pilot-server-key-0001",
      assignmentSignerPublicKeySpkiSha256 = assignmentSignerDigest,
      state = "active",
      issuedAt = "2026-09-04T10:00:05.000Z",
      validFrom = "2026-09-04T10:00:05.000Z",
      validUntil = "2026-10-04T10:00:05.000Z",
    )

  private fun acknowledgementBody(
    request: SignedDeviceBridgeRequest,
  ): DeviceBridgeAcknowledgementBody =
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

  private fun encode(bytes: ByteArray): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}
