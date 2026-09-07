package com.fetanagent.telebirrverifier

import java.lang.reflect.Modifier
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class VerifierEngineTest {
  @Test
  fun `shows the redacted pairing failure while enrollment is still required`() {
    val snapshot =
      VerifierOperationalSnapshot(
        operatorEnabled = false,
        status = LivePilotRuntimeStatus(LivePilotRuntimeState.ATTENTION, "pairing_retry_required"),
        updatedAtMillis = 1L,
      )

    assertEquals(
      "pairing_retry_required",
      VerifierStatusPresentation.code(verifierEnabled = true, enrolled = false, snapshot),
    )
    assertEquals(
      "provisioning_required",
      VerifierStatusPresentation.code(
        verifierEnabled = true,
        enrolled = false,
        snapshot.copy(
          status =
            LivePilotRuntimeStatus(
              LivePilotRuntimeState.ENROLLMENT_REQUIRED,
              "provisioning_required",
            ),
        ),
      ),
    )
    assertEquals(
      "device_enrollment_expired",
      VerifierStatusPresentation.code(
        verifierEnabled = true,
        enrolled = false,
        snapshot.copy(
          status =
            LivePilotRuntimeStatus(
              LivePilotRuntimeState.ENROLLMENT_REQUIRED,
              "device_enrollment_expired",
            ),
        ),
      ),
    )
    assertEquals(
      "build_disabled",
      VerifierStatusPresentation.code(verifierEnabled = false, enrolled = false, snapshot),
    )
  }

  @Test
  fun `binds retrieves parses and signs one advisory observation`() {
    val identity = JvmP256Identity()
    val engine =
      VerifierEngine(
        transport = ProviderTransport { providerFound() },
        parser = OfficialReceiptParser(),
        referenceBindingVerifier = matchingSyntheticReferenceBinding,
        clock = MillisClock { Instant.parse("2026-08-20T18:03:00.000Z").toEpochMilli() },
      )
    val observation =
      engine.observe(
        enrollment(identity),
        request(),
        lease(identity),
        CanonicalReference.fromCanonical(SYNTHETIC_REFERENCE),
        identity,
      )

    assertEquals(CanonicalTranscripts.observationBodyDigest(observation.body), observation.bodyDigest)
    assertEquals("found", observation.body.facts.lookupOutcome)
    assertEquals(86, observation.signature.length)
  }

  @Test
  fun `rejects a mismatched or expired lease before transport`() {
    val identity = JvmP256Identity()
    var calls = 0
    val engine =
      VerifierEngine(
        transport = ProviderTransport {
          calls += 1
          providerFound()
        },
        parser = OfficialReceiptParser(),
        referenceBindingVerifier = matchingSyntheticReferenceBinding,
        clock = MillisClock { 1_777_057_500_000L },
      )
    assertThrows(IllegalArgumentException::class.java) {
      engine.observe(
        enrollment(identity),
        request(),
        lease(identity).copy(referenceFingerprint = referenceFingerprint('8')),
        CanonicalReference.fromCanonical(SYNTHETIC_REFERENCE),
        identity,
      )
    }
    assertEquals(0, calls)
  }

  @Test
  fun `fails before transport when protected reference binding is unavailable or mismatched`() {
    val identity = JvmP256Identity()
    for (
      case in
        listOf(
          ProtectedReferenceBindingVerifier { _, _ -> ReferenceBindingVerdict.UNAVAILABLE } to
            CanonicalReference.fromCanonical(SYNTHETIC_REFERENCE),
          matchingSyntheticReferenceBinding to CanonicalReference.fromCanonical("DHK9130XYZ"),
        )
    ) {
      var calls = 0
      val engine =
        VerifierEngine(
          transport = ProviderTransport {
            calls += 1
            providerFound()
          },
          parser = OfficialReceiptParser(),
          referenceBindingVerifier = case.first,
          clock = MillisClock { Instant.parse("2026-08-20T18:03:00.000Z").toEpochMilli() },
        )

      assertThrows(IllegalArgumentException::class.java) {
        engine.observe(enrollment(identity), request(), lease(identity), case.second, identity)
      }
      assertEquals(0, calls)
    }
  }

  @Test
  fun `redacts identifiers digests signatures references names and bodies`() {
    val identity = JvmP256Identity()
    val observation = SignedObservationFactory.create(vectorBody(), identity)
    val projection = Redaction.forStatus(observation)
    val fieldNames = projection.javaClass.declaredFields.map { it.name }.toSet()

    assertFalse(
      fieldNames.any {
        it in
          setOf(
            "requestId",
            "jobId",
            "leaseId",
            "deviceId",
            "keyId",
            "challengeId",
            "receiverProfileId",
          )
      },
    )
    assertFalse(fieldNames.any { it.contains("digest", ignoreCase = true) })
    assertFalse(fieldNames.any { it.contains("signature", ignoreCase = true) && it != "signatureAlgorithm" })
    assertFalse(fieldNames.any { it.contains("reference", ignoreCase = true) })
    assertFalse(fieldNames.any { it.contains("name", ignoreCase = true) })
    assertFalse(fieldNames.any { it.contains("body", ignoreCase = true) })
    assertTrue(projection.advisoryOnly)
    assertFalse(projection.databaseWriteAllowed)
    assertFalse(projection.settlementAllowed)
    assertFalse(projection.financialActionAllowed)
    assertEquals("Disabled", VerifierLifecycle.disabled().label)
    assertEquals("Enrollment required", VerifierLifecycle.enrollmentRequired().label)
    assertEquals("Ready", VerifierLifecycle.ready().label)
    assertTrue(Modifier.isFinal(RedactedObservationProjection::class.java.modifiers))
  }
}
