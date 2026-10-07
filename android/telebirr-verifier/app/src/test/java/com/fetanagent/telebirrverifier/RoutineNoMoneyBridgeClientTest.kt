package com.fetanagent.telebirrverifier

import com.google.gson.Gson
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutineNoMoneyBridgeClientTest {
  private val device = JvmP256Identity("routine-device-key-0001")
  private val receiptSigner = JvmP256Identity("routine-receipt-key-0001")
  private val lookupSigner = JvmP256Identity("routine-server-key-0001")
  private val now = Instant.parse("2026-10-05T18:03:00.000Z").toEpochMilli()
  private val receiverNameDigest = requireNotNull(RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME))
  private val receiverId = "98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803"
  private val receiverProfileDigest = repeatedDigest('b')

  private fun receipt(): RoutineSignedEnrollmentReceipt {
    val body = RoutineEnrollmentReceiptBody(
      enrollmentId = "e0b29bed-3337-4a3d-8c31-87bec24f2056",
      pairingEvidenceDigest = repeatedDigest('f'),
      deviceId = "routine-device-0001",
      keyId = device.keyId,
      devicePublicKeySpkiSha256 = device.publicMaterial().publicKeySpkiSha256,
      receiverRevisionId = receiverId,
      receiverVersion = 3,
      receiverProfileDigest = receiverProfileDigest,
      expectedReceiverNameDigest = receiverNameDigest,
      validFrom = "2026-10-05T17:00:00.000Z",
      validUntil = "2026-10-06T17:00:00.000Z",
      issuedAt = "2026-10-05T17:01:00.000Z",
    )
    return RoutineSignedEnrollmentReceipt(
      bodyDigest = RoutineEnrollmentReceiptProtocol.bodyDigest(body),
      signerKeyId = receiptSigner.keyId,
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
        receiptSigner.signP1363(
          RoutineEnrollmentReceiptProtocol.signatureBytes(body, receiptSigner.keyId)),
      ),
    )
  }

  private fun trustedReceiptSigner(): RoutineEnrollmentTrustedSigner = RoutineEnrollmentTrustedSigner(
    signerKeyId = receiptSigner.keyId,
    publicKeySpki = receiptSigner.publicMaterial().publicKeySpkiBase64Url,
    publicKeySpkiSha256 = receiptSigner.publicMaterial().publicKeySpkiSha256,
    validFrom = "2026-10-05T17:00:00.000Z",
    validUntil = "2026-10-06T17:00:00.000Z",
    state = "active",
  )

  private fun trustedLookupSigner(): RoutineLookupTrustedSigner = RoutineLookupTrustedSigner(
    signerKeyId = lookupSigner.keyId,
    publicKeySpkiSha256 = lookupSigner.publicMaterial().publicKeySpkiSha256,
    state = "active",
    validFrom = "2026-10-05T17:00:00.000Z",
    validUntil = "2026-10-06T17:00:00.000Z",
  )

  private fun assignment(): RoutineSignedLookupAssignment {
    val body = RoutineLookupAssignmentBody(
      candidateId = "8b9b4a1c-616d-495b-a259-56d39ffef5d1",
      rawReference = PILOT_REFERENCE,
      referenceFingerprint = "a".repeat(64),
      referenceKeyVersion = 2,
      referenceProfileVersion = 2,
      submittedAt = "2026-10-05T18:00:00.000Z",
      receiverRevisionId = receiverId,
      receiverVersion = 3,
      receiverProfileDigest = receiverProfileDigest,
      receiverNameNormalizerVersion = RoutineTelebirrReceiverName.NORMALIZER_VERSION,
      expectedReceiverNameNormalized = PILOT_RECEIVER_NAME,
      expectedReceiverNameDigest = receiverNameDigest,
      deviceId = "routine-device-0001",
      keyId = device.keyId,
      challengeId = "328535af-2636-44cd-84be-6effdfe9cac1",
      challengeDigest = repeatedDigest('d'),
      sourceProfile = RoutineTelebirrLookupProtocol.SOURCE_PROFILE,
      issuedAt = "2026-10-05T18:02:00.000Z",
      expiresAt = "2026-10-05T18:05:00.000Z",
    )
    return RoutineSignedLookupAssignment(
      bodyDigest = RoutineLookupCanonicalTranscripts.bodyDigest(body),
      signerKeyId = lookupSigner.keyId,
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
        lookupSigner.signP1363(RoutineLookupCanonicalTranscripts.signatureBytes(body)),
      ),
    )
  }

  private fun pollResponse(assignment: RoutineSignedLookupAssignment): ByteArray =
    """{"outcome":"assignment","advisoryOnly":true,"financialActionAllowed":false,"signedAssignment":${Gson().toJson(assignment)}}"""
      .toByteArray(StandardCharsets.UTF_8)

  private fun observedReceipt(): ProviderDocument.Found = livePilotProviderFound(
    livePilotHtml().replace("20-08-2026 21:01:45", "05-10-2026 21:01:45"),
  ).copy(retrievedAt = "2026-10-05T18:03:00.000Z")

  private fun fixedExchange(
    handler: (String, String, ByteArray) -> DeviceBridgeRawResponse,
  ): FixedRoutineNoMoneyHttpsExchange = FixedRoutineNoMoneyHttpsExchange(
    executor = DeviceBridgeHttpsExecutor { url, _, contentType, body, _, _, _ ->
      val response = handler(url.path, contentType, body)
      DeviceBridgeHttpsResponse(response.statusCode, listOf(response.contentType),
        emptyList(), response.body)
    },
  )

  private fun rehearsal(exchange: FixedRoutineNoMoneyHttpsExchange, transport: ProviderTransport) =
    RoutineNoMoneyPhoneRehearsal(
      exchange,
      RoutineTelebirrObservationCollector(transport, clock = MillisClock { now }),
      MillisClock { now },
    )

  private fun run(rehearsal: RoutineNoMoneyPhoneRehearsal): RoutineNoMoneyPhoneResult =
    rehearsal.run(receipt(), trustedReceiptSigner(), trustedLookupSigner(),
      lookupSigner.keyPair.public.encoded, device)

  @Test fun `fixed routine transport accepts only its two paths and vendor media type`() {
    var captured: URL? = null
    val exchange = FixedRoutineNoMoneyHttpsExchange(
      FixedDeviceBridgeHttpsExchange.STAGING_DEPLOYMENT_TARGET,
    ) { url, target, contentType, body, connect, read, maximum ->
      captured = url
      assertEquals("staging", target)
      assertEquals(RoutineNoMoneyBridgeProtocol.CONTENT_TYPE, contentType)
      assertEquals(FixedDeviceBridgeHttpsExchange.CONNECT_TIMEOUT_MILLIS, connect)
      assertEquals(FixedDeviceBridgeHttpsExchange.READ_TIMEOUT_MILLIS, read)
      assertEquals(RoutineNoMoneyBridgeProtocol.MAX_RESPONSE_BYTES, maximum)
      assertTrue(body.contentEquals(byteArrayOf(1)))
      DeviceBridgeHttpsResponse(200, listOf(contentType), emptyList(), byteArrayOf(1))
    }
    exchange.post(RoutineNoMoneyBridgeProtocol.POLL_PATH,
      RoutineNoMoneyBridgeProtocol.CONTENT_TYPE, byteArrayOf(1))
    assertEquals("https", captured?.protocol)
    assertEquals(FixedDeviceBridgeHttpsExchange.ORIGIN_HOST, captured?.host)
    assertEquals(443, captured?.port)
    assertEquals(RoutineNoMoneyBridgeProtocol.POLL_PATH, captured?.path)
    assertEquals(null, captured?.query)
    assertThrows(IllegalArgumentException::class.java) {
      exchange.post(DeviceBridgeProtocol.ASSIGNMENT_POLL_PATH,
        RoutineNoMoneyBridgeProtocol.CONTENT_TYPE, byteArrayOf(1))
    }
    assertThrows(IllegalArgumentException::class.java) {
      exchange.post(RoutineNoMoneyBridgeProtocol.POLL_PATH,
        DeviceBridgeProtocol.CONTENT_TYPE, byteArrayOf(1))
    }
    assertThrows(IllegalArgumentException::class.java) {
      exchange.post(RoutineNoMoneyBridgeProtocol.POLL_PATH,
        RoutineNoMoneyBridgeProtocol.CONTENT_TYPE,
        ByteArray(RoutineNoMoneyBridgeProtocol.MAX_POLL_BYTES + 1))
    }
  }

  @Test fun `fixed routine transport rejects redirects compression and duplicate media headers`() {
    listOf(
      DeviceBridgeHttpsResponse(302, listOf(RoutineNoMoneyBridgeProtocol.CONTENT_TYPE), emptyList(), byteArrayOf()),
      DeviceBridgeHttpsResponse(200, listOf(RoutineNoMoneyBridgeProtocol.CONTENT_TYPE,
        RoutineNoMoneyBridgeProtocol.CONTENT_TYPE), emptyList(), byteArrayOf()),
      DeviceBridgeHttpsResponse(200, listOf(RoutineNoMoneyBridgeProtocol.CONTENT_TYPE),
        listOf("gzip"), byteArrayOf()),
    ).forEach { response ->
      val exchange = FixedRoutineNoMoneyHttpsExchange(executor =
        DeviceBridgeHttpsExecutor { _, _, _, _, _, _, _ -> response })
      assertThrows(DeviceBridgeRetryableException::class.java) {
        exchange.post(RoutineNoMoneyBridgeProtocol.POLL_PATH,
          RoutineNoMoneyBridgeProtocol.CONTENT_TYPE, byteArrayOf(1))
      }
    }
  }

  @Test fun `no assignment never contacts the provider or uploads`() {
    val paths = mutableListOf<String>()
    val exchange = fixedExchange { path, contentType, _ ->
      paths += path
      DeviceBridgeRawResponse(200, contentType,
        """{"outcome":"no_assignment","advisoryOnly":true,"financialActionAllowed":false}"""
          .toByteArray(StandardCharsets.UTF_8))
    }
    val result = run(rehearsal(exchange, ProviderTransport { _ ->
      error("No provider request is allowed")
    }))
    assertEquals(RoutineNoMoneyPhoneResult.NoAssignment, result)
    assertEquals(listOf(RoutineNoMoneyBridgeProtocol.POLL_PATH), paths)
  }

  @Test fun `one signed lookup yields a review-only upload with a redacted observation`() {
    val paths = mutableListOf<String>()
    var upload = ByteArray(0)
    var providerCalls = 0
    val exchange = fixedExchange { path, contentType, bytes ->
      paths += path
      assertEquals(RoutineNoMoneyBridgeProtocol.CONTENT_TYPE, contentType)
      when (path) {
        RoutineNoMoneyBridgeProtocol.POLL_PATH -> {
          assertFalse(String(bytes, StandardCharsets.UTF_8).contains(PILOT_REFERENCE))
          val frame = StrictJson.parse(bytes).requireObject(setOf("publicKeySpki", "signedRequest"))
          assertEquals(device.publicMaterial().publicKeySpkiBase64Url, frame.string("publicKeySpki"))
          assertTrue(frame.value("signedRequest") is JsonValue.Object)
          DeviceBridgeRawResponse(200, contentType, pollResponse(assignment()))
        }
        RoutineNoMoneyBridgeProtocol.UPLOAD_PATH -> {
          upload = bytes.copyOf()
          DeviceBridgeRawResponse(202, contentType,
            """{"outcome":"signed_evidence_received_for_review","advisoryOnly":true,"sourceAuthenticationPerformed":false,"financialActionAllowed":false}"""
              .toByteArray(StandardCharsets.UTF_8))
        }
        else -> error("Unexpected route")
      }
    }
    val result = run(rehearsal(exchange, ProviderTransport { route ->
      providerCalls++
      assertEquals(OfficialReceiptRoute.OFFICIAL_HOST, route.host)
      observedReceipt()
    }))
    assertEquals(RoutineNoMoneyPhoneResult.SubmittedForReview, result)
    assertEquals(1, providerCalls)
    assertEquals(listOf(RoutineNoMoneyBridgeProtocol.POLL_PATH,
      RoutineNoMoneyBridgeProtocol.UPLOAD_PATH), paths)
    val frame = StrictJson.parse(upload).requireObject(
      setOf("publicKeySpki", "signedAssignment", "signedObservation"))
    assertEquals(device.publicMaterial().publicKeySpkiBase64Url, frame.string("publicKeySpki"))
    assertTrue(frame.value("signedAssignment") is JsonValue.Object)
    assertTrue(frame.value("signedObservation") is JsonValue.Object)
    val observation = frame.value("signedObservation").requireObject(setOf(
      "contractVersion", "providerCode", "protocolMode", "transcriptVersion",
      "bodyDigestAlgorithm", "bodyDigest", "signatureAlgorithm", "signatureEncoding",
      "body", "signature"))
    assertEquals("sha256", observation.string("bodyDigestAlgorithm"))
    assertFalse(StrictJson.encode(observation).contains(PILOT_REFERENCE))
    assertFalse(StrictJson.encode(observation).contains(PILOT_RECEIVER_NAME))
    assertFalse(result.toString().contains(PILOT_REFERENCE))
  }

  @Test fun `forged assignment is rejected before provider contact or upload`() {
    var providerCalls = 0
    var uploadCalls = 0
    val valid = assignment()
    val forged = valid.copy(signature = (if (valid.signature[0] == 'A') "B" else "A") +
      valid.signature.drop(1))
    val exchange = fixedExchange { path, contentType, _ ->
      if (path == RoutineNoMoneyBridgeProtocol.UPLOAD_PATH) uploadCalls++
      DeviceBridgeRawResponse(200, contentType, pollResponse(forged))
    }
    val result = run(rehearsal(exchange, ProviderTransport { _ ->
      providerCalls++
      observedReceipt()
    }))
    assertEquals(RoutineNoMoneyPhoneResult.Review("signature_invalid"), result)
    assertEquals(0, providerCalls)
    assertEquals(0, uploadCalls)
  }

  @Test fun `an unsafe server response cannot trigger a provider lookup`() {
    var providerCalls = 0
    val exchange = fixedExchange { _, contentType, _ ->
      DeviceBridgeRawResponse(200, contentType,
        """{"outcome":"assignment","advisoryOnly":true,"financialActionAllowed":true,"signedAssignment":${Gson().toJson(assignment())}}"""
          .toByteArray(StandardCharsets.UTF_8))
    }
    val result = run(rehearsal(exchange, ProviderTransport { _ ->
      providerCalls++
      observedReceipt()
    }))
    assertEquals(RoutineNoMoneyPhoneResult.Review("invalid_assignment_response"), result)
    assertEquals(0, providerCalls)
  }
}
