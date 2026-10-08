package com.fetanagent.telebirrverifier

import com.google.gson.Gson
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RoutinePaidPhonePreparationTest {
  @get:Rule val temporary = TemporaryFolder()
  private val workCipher = TestCipher()
  private val workDirectory by lazy { File(temporary.root, "paid-work") }
  private val workStore by lazy { EncryptedRoutinePaidWorkStore(workDirectory, workCipher) }
  private val device = JvmP256Identity("paid-device-key-0001")
  private val receiptSigner = JvmP256Identity("paid-receipt-key-0001")
  private val lookupSigner = JvmP256Identity("paid-lookup-key-0001")
  private val now = Instant.parse("2026-10-05T18:03:00.000Z").toEpochMilli()
  private val receiverNameDigest = requireNotNull(RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME))
  private val receiverId = "98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803"
  private val receiverProfileDigest = repeatedDigest('b')

  private fun receipt(): RoutineSignedEnrollmentReceipt {
    val body = RoutineEnrollmentReceiptBody(
      enrollmentId = "e0b29bed-3337-4a3d-8c31-87bec24f2056",
      pairingEvidenceDigest = repeatedDigest('f'),
      deviceId = "paid-device-0001",
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

  private fun trustedReceiptSigner() = RoutineEnrollmentTrustedSigner(
    signerKeyId = receiptSigner.keyId,
    publicKeySpki = receiptSigner.publicMaterial().publicKeySpkiBase64Url,
    publicKeySpkiSha256 = receiptSigner.publicMaterial().publicKeySpkiSha256,
    validFrom = "2026-10-05T17:00:00.000Z",
    validUntil = "2026-10-06T17:00:00.000Z",
    state = "active",
  )

  private fun trustedLookupSigner() = RoutineLookupTrustedSigner(
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
      deviceId = "paid-device-0001",
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

  private fun paidAssignmentResponse(signed: RoutineSignedLookupAssignment = assignment()) =
    """{"outcome":"assignment","advisoryOnly":true,"paymentVerificationRequested":true,"financialActionAllowed":false,"signedAssignment":${Gson().toJson(signed)}}"""
      .toByteArray(StandardCharsets.UTF_8)

  private fun observedReceipt(): ProviderDocument.Found = livePilotProviderFound(
    livePilotHtml().replace("20-08-2026 21:01:45", "05-10-2026 21:01:45"),
  ).copy(retrievedAt = "2026-10-05T18:03:00.000Z")

  private fun exchange(
    handler: (String, String, ByteArray) -> DeviceBridgeRawResponse,
  ) = FixedRoutinePaidPollHttpsExchange(executor = DeviceBridgeHttpsExecutor {
    url, _, contentType, body, _, _, _ ->
    val result = handler(url.path, contentType, body)
    DeviceBridgeHttpsResponse(result.statusCode, listOf(result.contentType), emptyList(), result.body)
  })

  private fun preparation(
    exchange: FixedRoutinePaidPollHttpsExchange,
    transport: ProviderTransport,
    store: RoutinePaidWorkStore = workStore,
    at: Long = now,
  ) = RoutinePaidPhonePreparation(exchange,
    RoutineTelebirrObservationCollector(transport, clock = MillisClock { at }),
    store, MillisClock { at })

  private fun run(preparation: RoutinePaidPhonePreparation) = preparation.run(
    receipt(), trustedReceiptSigner(), trustedLookupSigner(), lookupSigner.keyPair.public.encoded,
    device,
  )

  @Test fun `paid HTTPS transport cannot call no-money pilot or an upload route`() {
    var calls = 0
    val fixed = FixedRoutinePaidPollHttpsExchange(executor = DeviceBridgeHttpsExecutor {
      url, target, contentType, body, _, _, maximum ->
      calls++
      assertEquals("https", url.protocol)
      assertEquals(FixedDeviceBridgeHttpsExchange.ORIGIN_HOST, url.host)
      assertEquals(443, url.port)
      assertEquals(RoutinePaidBridgeProtocol.POLL_PATH, url.path)
      assertEquals("production", target)
      assertEquals(RoutinePaidBridgeProtocol.CONTENT_TYPE, contentType)
      assertEquals(RoutinePaidBridgeProtocol.MAX_RESPONSE_BYTES, maximum)
      assertTrue(body.contentEquals(byteArrayOf(1)))
      DeviceBridgeHttpsResponse(200, listOf(contentType), emptyList(), byteArrayOf(1))
    })
    fixed.post(RoutinePaidBridgeProtocol.POLL_PATH, RoutinePaidBridgeProtocol.CONTENT_TYPE,
      byteArrayOf(1))
    assertEquals(1, calls)
    listOf(RoutineNoMoneyBridgeProtocol.POLL_PATH, RoutineNoMoneyBridgeProtocol.UPLOAD_PATH,
      DeviceBridgeProtocol.ASSIGNMENT_POLL_PATH, "/v1/telebirr/routine/paid/observations:upload")
      .forEach { path ->
        assertThrows(IllegalArgumentException::class.java) {
          fixed.post(path, RoutinePaidBridgeProtocol.CONTENT_TYPE, byteArrayOf(1))
        }
      }
    assertThrows(IllegalArgumentException::class.java) {
      fixed.post(RoutinePaidBridgeProtocol.POLL_PATH,
        RoutineNoMoneyBridgeProtocol.CONTENT_TYPE, byteArrayOf(1))
    }
    assertEquals(1, calls)
  }

  @Test fun `paid transport rejects redirects duplicate media type and compression`() {
    listOf(
      DeviceBridgeHttpsResponse(302, listOf(RoutinePaidBridgeProtocol.CONTENT_TYPE),
        emptyList(), byteArrayOf()),
      DeviceBridgeHttpsResponse(200, listOf(RoutinePaidBridgeProtocol.CONTENT_TYPE,
        RoutinePaidBridgeProtocol.CONTENT_TYPE), emptyList(), byteArrayOf()),
      DeviceBridgeHttpsResponse(200, listOf(RoutinePaidBridgeProtocol.CONTENT_TYPE),
        listOf("gzip"), byteArrayOf()),
    ).forEach { result ->
      val fixed = FixedRoutinePaidPollHttpsExchange(executor = DeviceBridgeHttpsExecutor {
        _, _, _, _, _, _, _ -> result
      })
      assertThrows(DeviceBridgeRetryableException::class.java) {
        fixed.post(RoutinePaidBridgeProtocol.POLL_PATH, RoutinePaidBridgeProtocol.CONTENT_TYPE,
          byteArrayOf(1))
      }
    }
  }

  @Test fun `no assignment never opens the public receipt`() {
    val fixed = exchange { path, contentType, bytes ->
      assertEquals(RoutinePaidBridgeProtocol.POLL_PATH, path)
      assertFalse(String(bytes, StandardCharsets.UTF_8).contains(PILOT_REFERENCE))
      val frame = StrictJson.parse(bytes).requireObject(setOf("publicKeySpki", "signedRequest"))
      val request = frame.value("signedRequest").requireObject(setOf(
        "contractVersion", "providerCode", "protocolMode", "transcriptVersion",
        "bodyDigestAlgorithm", "bodyDigest", "signatureAlgorithm", "signatureEncoding",
        "body", "signature"))
      assertEquals(RoutinePaidPollProtocol.MODE, request.string("protocolMode"))
      DeviceBridgeRawResponse(200, contentType,
        """{"outcome":"no_assignment","advisoryOnly":true,"paymentVerificationRequested":true,"financialActionAllowed":false}"""
          .toByteArray(StandardCharsets.UTF_8))
    }
    assertEquals(RoutinePaidPhonePreparationResult.NoAssignment,
      run(preparation(fixed, ProviderTransport { error("No receipt request") })))
    assertNull(workStore.load())
  }

  @Test fun `signed paid assignment persists before lookup and observation stays sealed`() {
    var calls = 0
    val fixed = exchange { path, contentType, _ ->
      calls++
      assertEquals(RoutinePaidBridgeProtocol.POLL_PATH, path)
      DeviceBridgeRawResponse(200, contentType, paidAssignmentResponse())
    }
    val result = run(preparation(fixed, ProviderTransport { route ->
      assertTrue(workStore.load() is RoutinePaidPendingWork.Assignment)
      assertEquals(OfficialReceiptRoute.OFFICIAL_HOST, route.host)
      observedReceipt()
    }))
    assertEquals(RoutinePaidPhonePreparationResult.PendingUpload, result)
    assertEquals(1, calls)
    val pending = workStore.load() as RoutinePaidPendingWork.Upload
    val frame = StrictJson.parse(pending.uploadBytes).requireObject(
      setOf("publicKeySpki", "signedAssignment", "signedObservation"))
    assertEquals(device.publicMaterial().publicKeySpkiBase64Url, frame.string("publicKeySpki"))
    assertFalse(StrictJson.encode(frame.value("signedObservation")).contains(PILOT_REFERENCE))
    val sealed = File(workDirectory, "routine-paid.sealed").readBytes()
    assertFalse(String(sealed, StandardCharsets.ISO_8859_1).contains(PILOT_REFERENCE))
    val restarted = EncryptedRoutinePaidWorkStore(workDirectory, workCipher)
    assertEquals(RoutinePaidPhonePreparationResult.PendingUpload,
      run(preparation(fixed, ProviderTransport { error("No repeat lookup") }, restarted)))
    val afterExpiry = Instant.parse("2026-10-05T18:06:00.000Z").toEpochMilli()
    assertEquals(RoutinePaidPhonePreparationResult.PendingUpload,
      run(preparation(fixed, ProviderTransport { error("No expired upload lookup") }, restarted,
        at = afterExpiry)))
    assertEquals(1, calls)
    assertTrue((restarted.load() as RoutinePaidPendingWork.Upload).uploadBytes
      .contentEquals(pending.uploadBytes))
  }

  @Test fun `no-money shape or forged paid assignment never reaches receipt`() {
    var providerCalls = 0
    val wrongMode = exchange { _, contentType, _ ->
      DeviceBridgeRawResponse(200, contentType,
        """{"outcome":"assignment","advisoryOnly":true,"financialActionAllowed":false,"signedAssignment":${Gson().toJson(assignment())}}"""
          .toByteArray(StandardCharsets.UTF_8))
    }
    assertEquals(RoutinePaidPhonePreparationResult.Review("invalid_assignment_response"),
      run(preparation(wrongMode, ProviderTransport { providerCalls++; observedReceipt() })))
    val valid = assignment()
    val forged = valid.copy(signature = (if (valid.signature[0] == 'A') "B" else "A") +
      valid.signature.drop(1))
    val forgedExchange = exchange { _, contentType, _ ->
      DeviceBridgeRawResponse(200, contentType, paidAssignmentResponse(forged))
    }
    assertEquals(RoutinePaidPhonePreparationResult.Review("signature_invalid"),
      run(preparation(forgedExchange, ProviderTransport { providerCalls++; observedReceipt() })))
    assertEquals(0, providerCalls)
    assertNull(workStore.load())
  }

  @Test fun `offline receipt retains assignment and restart does not consume another poll`() {
    var calls = 0
    val fixed = exchange { _, contentType, _ ->
      calls++
      DeviceBridgeRawResponse(200, contentType, paidAssignmentResponse())
    }
    assertEquals(RoutinePaidPhonePreparationResult.Review("transport_unavailable"),
      run(preparation(fixed, ProviderTransport { error("offline") })))
    assertTrue(workStore.load() is RoutinePaidPendingWork.Assignment)
    val restarted = EncryptedRoutinePaidWorkStore(workDirectory, workCipher)
    assertEquals(RoutinePaidPhonePreparationResult.PendingUpload,
      run(preparation(fixed, ProviderTransport { observedReceipt() }, restarted)))
    assertEquals(1, calls)
  }

  @Test fun `failed durable stage prevents public receipt lookup`() {
    val failed = EncryptedRoutinePaidWorkStore(File(temporary.root, "failed-paid"),
      object : LivePilotQueueCipher {
        override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray =
          error("Keystore unavailable")
        override fun open(sealed: ByteArray, associatedData: ByteArray): ByteArray =
          error("Keystore unavailable")
      })
    var providerCalls = 0
    val fixed = exchange { _, contentType, _ ->
      DeviceBridgeRawResponse(200, contentType, paidAssignmentResponse())
    }
    assertEquals(RoutinePaidPhonePreparationResult.Review("local_work_unavailable"),
      run(preparation(fixed, ProviderTransport { providerCalls++; observedReceipt() }, failed)))
    assertEquals(0, providerCalls)
  }

  @Test fun `expired uncollected assignment is discarded without another poll`() {
    val bytes = StrictJson.encode(StrictJson.parse(Gson().toJson(assignment())
      .toByteArray(StandardCharsets.UTF_8))).toByteArray(StandardCharsets.UTF_8)
    workStore.stageAssignment(bytes)
    val afterExpiry = Instant.parse("2026-10-05T18:06:00.000Z").toEpochMilli()
    val fixed = exchange { _, _, _ -> error("No poll after expired work") }
    assertEquals(RoutinePaidPhonePreparationResult.Review("lookup_expired"),
      run(preparation(fixed, ProviderTransport { error("No receipt") }, at = afterExpiry)))
    assertNull(workStore.load())
  }

  @Test fun `tampered paid work fails closed without another poll`() {
    val bytes = StrictJson.encode(StrictJson.parse(Gson().toJson(assignment())
      .toByteArray(StandardCharsets.UTF_8))).toByteArray(StandardCharsets.UTF_8)
    workStore.stageAssignment(bytes)
    val file = File(workDirectory, "routine-paid.sealed")
    val sealed = file.readBytes()
    sealed[sealed.lastIndex] = (sealed.last().toInt() xor 1).toByte()
    file.writeBytes(sealed)
    val fixed = exchange { _, _, _ -> error("No poll after tamper") }
    assertEquals(RoutinePaidPhonePreparationResult.Review("local_work_unavailable"),
      run(preparation(fixed, ProviderTransport { error("No receipt") })))
  }

  private class TestCipher : LivePilotQueueCipher {
    private val key = SecretKeySpec(ByteArray(32) { (it * 5 + 31).toByte() }, "AES")
    private val random = SecureRandom()

    override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray {
      val nonce = ByteArray(12).also(random::nextBytes)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
      cipher.updateAAD(associatedData)
      return nonce + cipher.doFinal(plaintext)
    }

    override fun open(sealed: ByteArray, associatedData: ByteArray): ByteArray {
      require(sealed.size > 28)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
      cipher.updateAAD(associatedData)
      return cipher.doFinal(sealed.copyOfRange(12, sealed.size))
    }
  }
}
