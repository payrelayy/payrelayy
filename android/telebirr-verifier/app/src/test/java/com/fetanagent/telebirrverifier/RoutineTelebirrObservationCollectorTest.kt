package com.fetanagent.telebirrverifier

import com.google.gson.Gson
import java.nio.charset.StandardCharsets
import java.net.InetAddress
import java.time.Instant
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutineTelebirrObservationCollectorTest {
  private val signer = JvmP256Identity("routine-server-key-0001")
  private val device = JvmP256Identity("routine-device-key-0001")
  private val body = RoutineLookupAssignmentBody(
    candidateId = "8b9b4a1c-616d-495b-a259-56d39ffef5d1",
    rawReference = PILOT_REFERENCE,
    referenceFingerprint = "a".repeat(64),
    referenceKeyVersion = 2,
    referenceProfileVersion = 2,
    submittedAt = "2026-10-05T18:00:00.000Z",
    receiverRevisionId = "98b5e8a9-79bb-4fa1-b2a7-6dbfd6ef1803",
    receiverVersion = 3,
    receiverProfileDigest = repeatedDigest('b'),
    receiverNameNormalizerVersion = RoutineTelebirrReceiverName.NORMALIZER_VERSION,
    expectedReceiverNameNormalized = PILOT_RECEIVER_NAME,
    expectedReceiverNameDigest = requireNotNull(RoutineTelebirrReceiverName.digest(PILOT_RECEIVER_NAME)),
    deviceId = "routine-device-0001",
    keyId = device.keyId,
    challengeId = "328535af-2636-44cd-84be-6effdfe9cac1",
    challengeDigest = repeatedDigest('d'),
    sourceProfile = RoutineTelebirrLookupProtocol.SOURCE_PROFILE,
    issuedAt = "2026-10-05T18:02:00.000Z",
    expiresAt = "2026-10-05T18:05:00.000Z",
  )
  private val trustedSigner = RoutineLookupTrustedSigner(
    signerKeyId = signer.keyId,
    publicKeySpkiSha256 = signer.publicMaterial().publicKeySpkiSha256,
    state = "active",
    validFrom = "2026-10-05T17:00:00.000Z",
    validUntil = "2026-10-06T17:00:00.000Z",
  )
  private val trustedEnrollment = RoutineLookupDeviceEnrollment(
    deviceId = body.deviceId,
    keyId = device.keyId,
    publicKeySpkiSha256 = device.publicMaterial().publicKeySpkiSha256,
    state = "active",
    validFrom = "2026-10-05T17:00:00.000Z",
    validUntil = "2026-10-06T17:00:00.000Z",
    receiverRevisionId = body.receiverRevisionId,
    receiverVersion = body.receiverVersion,
    receiverProfileDigest = body.receiverProfileDigest,
  )

  private fun signed(): RoutineSignedLookupAssignment = RoutineSignedLookupAssignment(
    bodyDigest = RoutineLookupCanonicalTranscripts.bodyDigest(body),
    signerKeyId = signer.keyId,
    body = body,
    signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
      signer.signP1363(RoutineLookupCanonicalTranscripts.signatureBytes(body)),
    ),
  )

  private fun collect(
    transport: ProviderTransport,
    assignment: RoutineSignedLookupAssignment = signed(),
    enrolled: RoutineLookupDeviceEnrollment = trustedEnrollment,
    clock: MillisClock = MillisClock { Instant.parse("2026-10-05T18:03:00.000Z").toEpochMilli() },
  ): RoutineTelebirrObservationCollection = RoutineTelebirrObservationCollector(
    transport = transport,
    clock = clock,
  ).collect(
    assignmentBytes = Gson().toJson(assignment).toByteArray(StandardCharsets.UTF_8),
    trustedSigner = trustedSigner,
    signerPublicSpkiDer = signer.keyPair.public.encoded,
    trustedEnrollment = enrolled,
    deviceIdentity = device,
  )

  private fun currentDocument(): ProviderDocument.Found = livePilotProviderFound(
    livePilotHtml().replace("20-08-2026 21:01:45", "05-10-2026 21:01:45"),
  ).copy(retrievedAt = "2026-10-05T18:03:00.000Z")

  @Test
  fun `authenticates the assignment before the official lookup and leaves signed evidence local`() {
    var lookups = 0
    val result = collect(ProviderTransport { route ->
      lookups++
      assertEquals(OfficialReceiptRoute.OFFICIAL_HOST, route.host)
      currentDocument()
    })
    assertEquals(1, lookups)
    assertTrue(result is RoutineTelebirrObservationCollection.WouldForward)
    val observation = (result as RoutineTelebirrObservationCollection.WouldForward).observation
    assertEquals(body.candidateId, observation.body.candidateId)
    assertEquals(body.challengeId, observation.body.challengeId)
    assertEquals(2_500L, observation.body.facts.amountMinor)
    val wire = RoutineTelebirrJsonCodec.encodeSignedObservation(observation)
    assertFalse(String(wire, StandardCharsets.UTF_8).contains(PILOT_REFERENCE))
    assertFalse(String(wire, StandardCharsets.UTF_8).contains(PILOT_RECEIVER_NAME))
    assertFalse(result.toString().contains(PILOT_REFERENCE))
    assertTrue(result.advisoryOnly)
    assertFalse(result.sourceAuthenticationPerformedByServer)
    assertFalse(result.databaseWriteAllowed)
    assertFalse(result.claimAllowed)
    assertFalse(result.settlementAllowed)
    assertFalse(result.enqueueAllowed)
    assertFalse(result.executionAllowed)
    assertFalse(result.financialActionAllowed)
  }

  @Test
  fun `reviewed safe transport signs a distinct official origin observation`() {
    val moment = Instant.parse("2026-10-05T18:03:00.000Z").toEpochMilli()
    val safe = SafeOfficialReceiptTransport(
      resolver = HostResolver { _, _ -> listOf(InetAddress.getByName("1.1.1.1")) },
      exchange = HttpsExchange { _, _, _, _, _ ->
        RawHttpsResponse(
          200,
          "text/html; charset=utf-8",
          null,
          livePilotHtml().replace("20-08-2026 21:01:45", "05-10-2026 21:01:45")
            .toByteArray(StandardCharsets.UTF_8),
        )
      },
      clock = MillisClock { moment },
    )
    val collected = collect(safe)
    assertTrue(collected is RoutineTelebirrObservationCollection.WouldForward)
    val observation = (collected as RoutineTelebirrObservationCollection.WouldForward).observation
    assertEquals(2, observation.contractVersion)
    assertEquals("routine_signed_observation_v2", observation.protocolMode)
    assertEquals("official_tls_origin", observation.body.facts.sourceOriginAttestation)
    assertTrue(String(RoutineTelebirrJsonCodec.encodeSignedObservation(observation),
      StandardCharsets.UTF_8).contains("\"sourceOriginAttestation\":\"official_tls_origin\""))
    assertFalse(collected.financialActionAllowed)
  }

  @Test
  fun `rejects forged expired and revoked assignments before any provider call`() {
    var lookups = 0
    val transport = ProviderTransport { _ -> lookups++; currentDocument() }
    val valid = signed()
    val forged = valid.copy(
      signature = (if (valid.signature[0] == 'A') "B" else "A") + valid.signature.drop(1),
    )
    assertEquals(
      "signature_invalid",
      (collect(transport, assignment = forged) as RoutineTelebirrObservationCollection.Review).reasonCode,
    )
    assertEquals(
      "lookup_expired",
      (collect(transport, clock = MillisClock { Instant.parse("2026-10-05T18:05:00.000Z").toEpochMilli() })
        as RoutineTelebirrObservationCollection.Review).reasonCode,
    )
    assertEquals(
      "device_revoked_or_expired",
      (collect(transport, enrolled = trustedEnrollment.copy(state = "revoked"))
        as RoutineTelebirrObservationCollection.Review).reasonCode,
    )
    assertEquals(0, lookups)
  }

  @Test
  fun `unattested unavailable and late receipts fail closed without a forwardable observation`() {
    val unattested = collect(ProviderTransport { _ ->
      currentDocument().copy(originAttestation = ProviderDocumentOriginAttestation.UNATTESTED)
    })
    assertEquals(
      "unknown_layout_provider_identity",
      (unattested as RoutineTelebirrObservationCollection.Review).reasonCode,
    )
    val unavailable = collect(ProviderTransport { _ -> throw IllegalStateException(PILOT_REFERENCE) })
    assertEquals(
      "transport_unavailable",
      (unavailable as RoutineTelebirrObservationCollection.Review).reasonCode,
    )
    assertFalse(unavailable.toString().contains(PILOT_REFERENCE))
    val late = collect(ProviderTransport { _ ->
      currentDocument().copy(retrievedAt = "2026-10-05T18:05:00.000Z")
    })
    assertEquals(
      "observation_invalid",
      (late as RoutineTelebirrObservationCollection.Review).reasonCode,
    )
    var now = Instant.parse("2026-10-05T18:03:00.000Z").toEpochMilli()
    val crossedLease = collect(
      ProviderTransport { _ ->
        now = Instant.parse("2026-10-05T18:05:00.000Z").toEpochMilli()
        currentDocument()
      },
      clock = MillisClock { now },
    )
    assertEquals(
      "lookup_expired",
      (crossedLease as RoutineTelebirrObservationCollection.Review).reasonCode,
    )
    var rollbackClock = Instant.parse("2026-10-05T18:03:00.000Z").toEpochMilli()
    val rolledBack = collect(
      ProviderTransport { _ ->
        rollbackClock -= 1_000L
        currentDocument()
      },
      clock = MillisClock { rollbackClock },
    )
    assertEquals(
      "lookup_expired",
      (rolledBack as RoutineTelebirrObservationCollection.Review).reasonCode,
    )
  }
}
