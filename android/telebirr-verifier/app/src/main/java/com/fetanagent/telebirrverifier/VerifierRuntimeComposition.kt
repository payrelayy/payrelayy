package com.fetanagent.telebirrverifier

import android.content.Context
import java.time.Instant

fun interface VerifierRuntimeCycle {
  fun runOnce(): LivePilotRuntimeStatus
}

fun interface VerifierRuntimeHeartbeat {
  fun heartbeat(status: LivePilotRuntimeStatus): DeviceBridgeHeartbeatResult
}

class VerifierRuntimeSession(
  val cycle: VerifierRuntimeCycle,
  val heartbeat: VerifierRuntimeHeartbeat?,
) {
  override fun toString(): String = "VerifierRuntimeSession(<redacted>)"
}

/**
 * Fail-closed operational composition. CI builds have no profile and remain inert. A separately
 * signed operational release can first run in pairing-only mode, which sends only redacted signed
 * heartbeat state. Evidence mode is a distinct build decision and is the only mode that constructs
 * the official provider transport or polls an assignment.
 */
object VerifierRuntimeComposition {
  fun create(context: Context): VerifierRuntimeSession {
    val profile = DeviceBridgeBootstrapProfile.fromBuildConfig()
      ?: return unavailable(LivePilotRuntimeState.ENROLLMENT_REQUIRED, "provisioning_required")
    val provisioning = provisioningStore(context).load()
    val enrolled = provisioning as? DeviceProvisioningState.Enrolled
      ?: return unavailable(LivePilotRuntimeState.ENROLLMENT_REQUIRED, "provisioning_required")
    val certificate = enrolled.certificate
    val now = Instant.ofEpochMilli(System.currentTimeMillis())
    val rejection = enrollmentRejectionCode(profile, certificate, now)
    if (rejection != null) {
      return unavailable(LivePilotRuntimeState.ENROLLMENT_REQUIRED, rejection)
    }

    val identity = AndroidKeystoreP256Identity(certificate.body.keyId)
    val client =
      AuthenticatedDeviceBridgeClient(
        certificate = certificate,
        trustedServerSpkiDer = profile.serverSignerPublicKeySpkiDer(),
        identity = identity,
        exchange = FixedDeviceBridgeHttpsExchange(),
        appVersion = BuildConfig.VERSION_NAME,
      )

    return when (profile.runtimeMode) {
      VerifierRuntimeMode.INERT -> error("An enabled verifier cannot have inert runtime mode")
      VerifierRuntimeMode.PAIRING_ONLY ->
        VerifierRuntimeSession(
          cycle =
            VerifierRuntimeCycle {
              LivePilotRuntimeStatus(
                state = LivePilotRuntimeState.READY,
                code = "transport_enrolled",
              )
            },
          heartbeat = VerifierRuntimeHeartbeat(client::heartbeat),
        )
      VerifierRuntimeMode.EVIDENCE_ONLY ->
        evidenceSession(context, profile, certificate, identity, client)
    }
  }

  fun isEnrolled(context: Context): Boolean {
    if (!BuildConfig.VERIFIER_ENABLED) return false
    val profile = DeviceBridgeBootstrapProfile.fromBuildConfig() ?: return false
    val enrolled = provisioningStore(context).load() as? DeviceProvisioningState.Enrolled
      ?: return false
    return enrollmentRejectionCode(profile, enrolled.certificate, Instant.now()) == null
  }

  fun pairingCoordinator(context: Context): DevicePairingCoordinator {
    val profile = requireNotNull(DeviceBridgeBootstrapProfile.fromBuildConfig())
    return DevicePairingCoordinator(
      profile = profile,
      store = provisioningStore(context),
      exchange = FixedDeviceBridgeHttpsExchange(),
    )
  }

  private fun evidenceSession(
    context: Context,
    profile: DeviceBridgeBootstrapProfile,
    certificate: SignedDeviceBridgeEnrollmentCertificate,
    identity: P256Identity,
    client: AuthenticatedDeviceBridgeClient,
  ): VerifierRuntimeSession {
    val body = certificate.body
    val trustedSigner =
      LivePilotTrustedAssignmentSigner(
        contractVersion = LivePrivatePilotProtocol.CONTRACT_VERSION,
        providerCode = LivePrivatePilotProtocol.PROVIDER_CODE,
        protocolMode = LivePrivatePilotProtocol.PROTOCOL_MODE,
        signerKeyId = body.assignmentSignerKeyId,
        publicKeySpkiSha256 = body.assignmentSignerPublicKeySpkiSha256,
        signatureAlgorithm = LivePrivatePilotProtocol.SIGNATURE_ALGORITHM,
        state = "active",
        validFrom = body.validFrom,
        validUntil = body.validUntil,
      )
    val coordinator =
      LivePrivatePilotRuntimeCoordinator(
        gate =
          LivePilotRuntimeGate(
            buildEnabled = true,
            providerObservationEnabled = true,
            operatorEnabled = true,
          ),
        trustedSigner = trustedSigner,
        enrollment = body.livePilotEnrollment(),
        signerPublicSpkiDer = profile.assignmentSignerPublicKeySpkiDer(),
        identity = identity,
        assignmentSource = client,
        transport = SafeOfficialReceiptTransport(),
        parser = LivePrivatePilotReceiptParser(),
        uploader = client,
        workStore = EncryptedFileLivePilotWorkStore.forApplication(context),
      )
    return VerifierRuntimeSession(
      cycle = VerifierRuntimeCycle(coordinator::runOnce),
      heartbeat = VerifierRuntimeHeartbeat(client::heartbeat),
    )
  }

  private fun provisioningStore(context: Context): EncryptedFileDeviceProvisioningStore =
    EncryptedFileDeviceProvisioningStore.forApplication(context)

  private fun enrollmentRejectionCode(
    profile: DeviceBridgeBootstrapProfile,
    certificate: SignedDeviceBridgeEnrollmentCertificate,
    assessedAt: Instant,
  ): String? {
    if (runCatching { profile.requireCertificateBinding(certificate) }.isFailure) {
      return "enrollment_invalid"
    }
    val body = certificate.body
    if (body.state != "active") return "device_revoked"
    if (!DeviceBridgeAppVersion.atLeast(BuildConfig.VERSION_NAME, body.minimumAppVersion)) {
      return "app_version_unsupported"
    }
    val validFrom = runCatching { Instant.parse(body.validFrom) }.getOrNull()
      ?: return "enrollment_invalid"
    val validUntil = runCatching { Instant.parse(body.validUntil) }.getOrNull()
      ?: return "enrollment_invalid"
    if (assessedAt < validFrom) return "device_enrollment_not_yet_valid"
    if (assessedAt >= validUntil) return "device_enrollment_expired"
    return null
  }

  private fun unavailable(
    state: LivePilotRuntimeState,
    code: String,
  ): VerifierRuntimeSession =
    VerifierRuntimeSession(
      cycle = VerifierRuntimeCycle { LivePilotRuntimeStatus(state, code) },
      heartbeat = null,
    )
}
