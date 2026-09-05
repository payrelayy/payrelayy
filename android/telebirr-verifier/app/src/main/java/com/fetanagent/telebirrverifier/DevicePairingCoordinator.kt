package com.fetanagent.telebirrverifier

import java.time.Instant
import java.util.UUID

class DevicePairingFailure(
  val code: String,
  cause: Throwable? = null,
) : RuntimeException("Device pairing failed: $code", cause) {
  init {
    DeviceBridgeProtocol.requireStatusCode(code)
  }
}

fun interface DevicePairingIdentityFactory {
  fun create(keyId: String): P256Identity
}

fun interface DevicePairingIdentifierSource {
  fun next(prefix: String): String
}

/**
 * Creates and durably stages the exact signed one-use request before contacting the bridge. A lost
 * response therefore retries the same request; it never silently signs a second request for a
 * challenge the server may already have consumed.
 */
class DevicePairingCoordinator(
  private val profile: DeviceBridgeBootstrapProfile,
  private val store: DeviceProvisioningStore,
  private val exchange: DeviceBridgeExchange,
  private val identityFactory: DevicePairingIdentityFactory =
    DevicePairingIdentityFactory { keyId -> AndroidKeystoreP256Identity(keyId) },
  private val identifierSource: DevicePairingIdentifierSource =
    DevicePairingIdentifierSource { prefix ->
      "${prefix}_${UUID.randomUUID().toString().replace("-", "")}"
    },
  private val appVersion: String = BuildConfig.VERSION_NAME,
  private val clock: MillisClock = MillisClock(System::currentTimeMillis),
) {
  @Synchronized
  fun pair(packageValue: String): SignedDeviceBridgeEnrollmentCertificate {
    val grant =
      DeviceBridgeJsonCodec.decodePairingGrantPackage(packageValue)
        ?: throw DevicePairingFailure("pairing_package_invalid")
    val nowMillis = safeNow()
    val grantExpiry = runCatching { Instant.parse(grant.expiresAt).toEpochMilli() }
      .getOrElse { throw DevicePairingFailure("pairing_package_invalid", it) }
    if (nowMillis >= grantExpiry) throw DevicePairingFailure("pairing_challenge_expired")
    if (grantExpiry - nowMillis > MAXIMUM_GRANT_WINDOW_MILLIS) {
      throw DevicePairingFailure("pairing_package_invalid")
    }

    val existing =
      runCatching { store.load() }
        .getOrElse { throw DevicePairingFailure("provisioning_store_unavailable", it) }
    if (existing is DeviceProvisioningState.Enrolled) {
      if (existing.certificate.body.pairingId == grant.pairingId) {
        validateCertificate(existing.certificate, nowMillis)
        return existing.certificate
      }
      if (nowMillis < Instant.parse(existing.certificate.body.validUntil).toEpochMilli()) {
        throw DevicePairingFailure("pairing_enrollment_active")
      }
    }

    val pending =
      when (existing) {
        null -> createPending(grant, nowMillis, null)
        is DeviceProvisioningState.Pending -> {
          if (existing.grant == grant) {
            val requestExpiry = Instant.parse(existing.signedPairingRequest.body.expiresAt).toEpochMilli()
            if (nowMillis >= requestExpiry) {
              throw DevicePairingFailure("pairing_request_expired")
            }
            existing
          } else {
            val previousExpiry = Instant.parse(existing.grant.expiresAt).toEpochMilli()
            if (nowMillis < previousExpiry) {
              throw DevicePairingFailure("pairing_pending_conflict")
            }
            createPending(grant, nowMillis, IdentityBinding.from(existing))
          }
        }
        is DeviceProvisioningState.Enrolled ->
          createPending(grant, nowMillis, IdentityBinding.from(existing))
      }

    runCatching { store.stagePending(pending) }
      .getOrElse { throw DevicePairingFailure("provisioning_store_unavailable", it) }
    val certificate =
      try {
        DeviceBridgeEnrollmentClient(
            exchange = exchange,
            trustedServerSpkiDer = profile.serverSignerPublicKeySpkiDer(),
            clock = clock,
          )
          .enroll(pending.signedPairingRequest)
      } catch (failure: DeviceBridgeRetryableException) {
        throw DevicePairingFailure("pairing_retry_required", failure)
      } catch (failure: Exception) {
        throw DevicePairingFailure("pairing_rejected", failure)
      }
    validateCertificate(certificate, safeNow())
    runCatching { store.complete(certificate) }
      .getOrElse { throw DevicePairingFailure("provisioning_store_unavailable", it) }
    return certificate
  }

  private fun createPending(
    grant: DevicePairingGrant,
    nowMillis: Long,
    previous: IdentityBinding?,
  ): DeviceProvisioningState.Pending {
    val keyId = previous?.keyId ?: identifierSource.next("device_key")
    val deviceId = previous?.deviceId ?: identifierSource.next("device")
    DeviceBridgeProtocol.requireOpaqueId(keyId, "keyId")
    DeviceBridgeProtocol.requireOpaqueId(deviceId, "deviceId")
    val identity =
      runCatching { identityFactory.create(keyId) }
        .getOrElse { throw DevicePairingFailure("device_identity_unavailable", it) }
    val material =
      runCatching { identity.publicMaterial() }
        .getOrElse { throw DevicePairingFailure("device_identity_unavailable", it) }
    require(material.keyId == keyId)
    if (previous != null) {
      require(material.publicKeySpkiBase64Url == previous.publicKeySpki)
      require(material.publicKeySpkiSha256 == previous.publicKeySpkiSha256)
    }
    val expiresAtMillis =
      minOf(
        Instant.parse(grant.expiresAt).toEpochMilli(),
        nowMillis + MAXIMUM_REQUEST_WINDOW_MILLIS,
      )
    if (expiresAtMillis <= nowMillis) throw DevicePairingFailure("pairing_challenge_expired")
    val issuedAtMillis =
      (nowMillis - REQUEST_CLOCK_SKEW_TOLERANCE_MILLIS).coerceAtLeast(0L)
    val body =
      DeviceBridgePairingBody(
        pairingId = grant.pairingId,
        pairingNonceDigest = grant.pairingNonceDigest,
        deviceId = deviceId,
        keyId = keyId,
        devicePublicKeySpki = material.publicKeySpkiBase64Url,
        devicePublicKeySpkiSha256 = material.publicKeySpkiSha256,
        appVersion = appVersion,
        issuedAt = SafeOfficialReceiptTransport.canonicalTimestamp(issuedAtMillis),
        expiresAt = SafeOfficialReceiptTransport.canonicalTimestamp(expiresAtMillis),
      )
    val signed =
      runCatching { DeviceBridgeSignedFactory.pairing(body, identity) }
        .getOrElse { throw DevicePairingFailure("device_identity_unavailable", it) }
    return DeviceProvisioningState.Pending(grant, signed)
  }

  private fun validateCertificate(
    certificate: SignedDeviceBridgeEnrollmentCertificate,
    nowMillis: Long,
  ) {
    try {
      profile.requireCertificateBinding(certificate)
      require(certificate.body.state == "active")
      require(
        DeviceBridgeAppVersion.atLeast(appVersion, certificate.body.minimumAppVersion),
      )
      val now = Instant.ofEpochMilli(nowMillis)
      require(now >= Instant.parse(certificate.body.validFrom))
      require(now < Instant.parse(certificate.body.validUntil))
    } catch (failure: Exception) {
      throw DevicePairingFailure("pairing_trust_invalid", failure)
    }
  }

  private fun safeNow(): Long =
    runCatching { clock.nowMillis().also { require(it >= 0L) } }
      .getOrElse { throw DevicePairingFailure("device_clock_unavailable", it) }

  override fun toString(): String = "DevicePairingCoordinator(<redacted>)"

  private data class IdentityBinding(
    val deviceId: String,
    val keyId: String,
    val publicKeySpki: String,
    val publicKeySpkiSha256: String,
  ) {
    companion object {
      fun from(state: DeviceProvisioningState.Pending): IdentityBinding {
        val body = state.signedPairingRequest.body
        return IdentityBinding(
          body.deviceId,
          body.keyId,
          body.devicePublicKeySpki,
          body.devicePublicKeySpkiSha256,
        )
      }

      fun from(state: DeviceProvisioningState.Enrolled): IdentityBinding {
        val body = state.certificate.body
        return IdentityBinding(
          body.deviceId,
          body.keyId,
          body.devicePublicKeySpki,
          body.devicePublicKeySpkiSha256,
        )
      }
    }
  }

  companion object {
    private const val MAXIMUM_GRANT_WINDOW_MILLIS = 30 * 60 * 1_000L
    private const val MAXIMUM_REQUEST_WINDOW_MILLIS = 5 * 60 * 1_000L
    private const val REQUEST_CLOCK_SKEW_TOLERANCE_MILLIS = 30 * 1_000L
  }
}
