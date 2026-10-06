package com.fetanagent.telebirrverifier

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.Base64

/** An untrusted Owner-package shape; the future server must authenticate it from its own store. */
internal data class RoutineDevicePairingChallenge(
  val contractVersion: Int = 1,
  val providerCode: String = "telebirr",
  val protocolMode: String = RoutineDevicePairingProtocol.MODE,
  val pairingId: String,
  val pairingNonceDigest: String,
  val receiverRevisionId: String,
  val receiverVersion: Int,
  val receiverProfileDigest: String,
  val expectedReceiverNameDigest: String,
  val issuedAt: String,
  val expiresAt: String,
) {
  init {
    RoutineDevicePairingProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    RoutineDevicePairingProtocol.requireBinding(
      pairingId, pairingNonceDigest, receiverRevisionId, receiverVersion,
      receiverProfileDigest, expectedReceiverNameDigest,
    )
    RoutineTelebirrLookupProtocol.requireUtc(issuedAt)
    RoutineTelebirrLookupProtocol.requireUtc(expiresAt)
    require(Instant.parse(expiresAt).toEpochMilli() - Instant.parse(issuedAt).toEpochMilli() in 1..600_000)
  }

  override fun toString(): String = "RoutineDevicePairingChallenge(<redacted>)"
}

internal object RoutineDevicePairingProtocol {
  const val MODE = "routine_device_pairing_v1"
  const val TRANSCRIPT_VERSION = "telebirr-routine-device-pairing-transcript-v1"

  fun requireHeader(contractVersion: Int, providerCode: String, protocolMode: String) {
    require(contractVersion == 1 && providerCode == "telebirr" && protocolMode == MODE)
  }

  fun requireBinding(
    pairingId: String,
    pairingNonceDigest: String,
    receiverRevisionId: String,
    receiverVersion: Int,
    receiverProfileDigest: String,
    expectedReceiverNameDigest: String,
  ) {
    val p = RoutineTelebirrLookupProtocol
    require(p.UUID_V4.matches(pairingId) && p.DIGEST.matches(pairingNonceDigest))
    require(p.UUID_V4.matches(receiverRevisionId) && receiverVersion > 0)
    require(p.DIGEST.matches(receiverProfileDigest) && p.DIGEST.matches(expectedReceiverNameDigest))
  }
}

internal data class RoutineDevicePairingBody(
  val contractVersion: Int = 1,
  val providerCode: String = "telebirr",
  val protocolMode: String = RoutineDevicePairingProtocol.MODE,
  val pairingId: String,
  val pairingNonceDigest: String,
  val receiverRevisionId: String,
  val receiverVersion: Int,
  val receiverProfileDigest: String,
  val expectedReceiverNameDigest: String,
  val deviceId: String,
  val keyId: String,
  val devicePublicKeySpki: String,
  val devicePublicKeySpkiSha256: String,
  val issuedAt: String,
  val expiresAt: String,
) {
  init {
    val p = RoutineTelebirrLookupProtocol
    RoutineDevicePairingProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    RoutineDevicePairingProtocol.requireBinding(
      pairingId, pairingNonceDigest, receiverRevisionId, receiverVersion,
      receiverProfileDigest, expectedReceiverNameDigest,
    )
    require(p.OPAQUE_ID.matches(deviceId) && p.OPAQUE_ID.matches(keyId))
    require(devicePublicKeySpki.length in 1..684)
    require(Regex("^[A-Za-z0-9_-]+$").matches(devicePublicKeySpki))
    require(p.DIGEST.matches(devicePublicKeySpkiSha256))
    val decoded = Base64.getUrlDecoder().decode(devicePublicKeySpki)
    require(decoded.size in 64..512)
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == devicePublicKeySpki)
    require(RoutineLookupCanonicalTranscripts.sha256(decoded) == devicePublicKeySpkiSha256)
    p.requireUtc(issuedAt)
    p.requireUtc(expiresAt)
    require(Instant.parse(expiresAt).toEpochMilli() - Instant.parse(issuedAt).toEpochMilli() in 1..300_000)
  }

  override fun toString(): String = "RoutineDevicePairingBody(<redacted>)"
}

internal data class RoutineSignedDevicePairingProof(
  val contractVersion: Int = 1,
  val providerCode: String = "telebirr",
  val protocolMode: String = RoutineDevicePairingProtocol.MODE,
  val transcriptVersion: String = RoutineDevicePairingProtocol.TRANSCRIPT_VERSION,
  val bodyDigestAlgorithm: String = "sha256",
  val bodyDigest: String,
  val signatureAlgorithm: String = "ecdsa-p256-sha256",
  val signatureEncoding: String = "ieee-p1363-base64url",
  val body: RoutineDevicePairingBody,
  val signature: String,
) {
  init {
    RoutineDevicePairingProtocol.requireHeader(contractVersion, providerCode, protocolMode)
    require(transcriptVersion == RoutineDevicePairingProtocol.TRANSCRIPT_VERSION)
    require(bodyDigestAlgorithm == "sha256" && RoutineTelebirrLookupProtocol.DIGEST.matches(bodyDigest))
    require(signatureAlgorithm == "ecdsa-p256-sha256" && signatureEncoding == "ieee-p1363-base64url")
    require(RoutineTelebirrLookupProtocol.SIGNATURE.matches(signature))
    require(Base64.getUrlEncoder().withoutPadding().encodeToString(Base64.getUrlDecoder().decode(signature)) == signature)
  }

  override fun toString(): String = "RoutineSignedDevicePairingProof(<redacted>)"
}

internal object RoutineDevicePairingCanonical {
  fun bodyBytes(body: RoutineDevicePairingBody): ByteArray =
    RoutineLookupCanonicalTranscripts.encode(
      "fetanagent:telebirr:routine:device-pairing-body:v1",
      listOf(
        "contractVersion" to body.contractVersion,
        "providerCode" to body.providerCode,
        "protocolMode" to body.protocolMode,
        "pairingId" to body.pairingId,
        "pairingNonceDigest" to body.pairingNonceDigest,
        "receiverRevisionId" to body.receiverRevisionId,
        "receiverVersion" to body.receiverVersion,
        "receiverProfileDigest" to body.receiverProfileDigest,
        "expectedReceiverNameDigest" to body.expectedReceiverNameDigest,
        "deviceId" to body.deviceId,
        "keyId" to body.keyId,
        "devicePublicKeySpki" to body.devicePublicKeySpki,
        "devicePublicKeySpkiSha256" to body.devicePublicKeySpkiSha256,
        "issuedAt" to body.issuedAt,
        "expiresAt" to body.expiresAt,
      ),
    )

  fun bodyDigest(body: RoutineDevicePairingBody): String =
    RoutineLookupCanonicalTranscripts.sha256(bodyBytes(body))

  fun signatureBytes(body: RoutineDevicePairingBody): ByteArray =
    RoutineLookupCanonicalTranscripts.encode(
      RoutineDevicePairingProtocol.TRANSCRIPT_VERSION,
      listOf("bodyDigest" to bodyDigest(body)),
    )
}

/** Creates a domain-separated device signature, but never pairs or enrolls the phone. */
internal object RoutineDevicePairingProofFactory {
  fun create(
    challenge: RoutineDevicePairingChallenge,
    deviceId: String,
    identity: P256Identity,
    issuedAt: String,
    expiresAt: String,
  ): RoutineSignedDevicePairingProof {
    val requestIssued = Instant.parse(issuedAt).toEpochMilli()
    val requestExpires = Instant.parse(expiresAt).toEpochMilli()
    require(requestIssued >= Instant.parse(challenge.issuedAt).toEpochMilli())
    require(requestExpires <= Instant.parse(challenge.expiresAt).toEpochMilli())
    val material = identity.publicMaterial()
    require(material.keyId == identity.keyId)
    val body =
      RoutineDevicePairingBody(
        pairingId = challenge.pairingId,
        pairingNonceDigest = challenge.pairingNonceDigest,
        receiverRevisionId = challenge.receiverRevisionId,
        receiverVersion = challenge.receiverVersion,
        receiverProfileDigest = challenge.receiverProfileDigest,
        expectedReceiverNameDigest = challenge.expectedReceiverNameDigest,
        deviceId = deviceId,
        keyId = identity.keyId,
        devicePublicKeySpki = material.publicKeySpkiBase64Url,
        devicePublicKeySpkiSha256 = material.publicKeySpkiSha256,
        issuedAt = issuedAt,
        expiresAt = expiresAt,
      )
    val signature = identity.signP1363(RoutineDevicePairingCanonical.signatureBytes(body))
    require(signature.size == 64)
    return RoutineSignedDevicePairingProof(
      bodyDigest = RoutineDevicePairingCanonical.bodyDigest(body),
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signature),
    )
  }
}

/** Offline Owner-to-phone-to-Owner handoff. This neither enrolls nor starts the verifier. */
internal object RoutineDevicePairingHandoff {
  private val utcFormatter = DateTimeFormatterBuilder().appendInstant(3).toFormatter()
  private const val MAX_REQUEST_MILLIS = 300_000L
  private const val HANDOFF_MILLIS = 240_000L
  private const val CLOCK_MARGIN_MILLIS = 30_000L

  fun createProof(packageValue: String, identity: P256Identity, nowMillis: Long): ByteArray {
    val challenge = RoutineDevicePairingJsonCodec.decodeChallengePackage(packageValue)
      ?: throw IllegalArgumentException("routine_pairing_package_invalid")
    val issued = Instant.parse(challenge.issuedAt).toEpochMilli()
    val expires = Instant.parse(challenge.expiresAt).toEpochMilli()
    require(nowMillis in issued until expires) { "routine_pairing_challenge_expired" }
    val requestIssued = maxOf(issued, nowMillis - CLOCK_MARGIN_MILLIS)
    val proofExpires = minOf(expires, nowMillis + HANDOFF_MILLIS, requestIssued + MAX_REQUEST_MILLIS)
    require(proofExpires > nowMillis && proofExpires > requestIssued)
    val material = identity.publicMaterial()
    require(material.keyId == identity.keyId)
    val fingerprint = material.publicKeySpkiSha256.removePrefix("sha256:")
    require(fingerprint.length == 64 && fingerprint.all { it in '0'..'9' || it in 'a'..'f' })
    val proof = RoutineDevicePairingProofFactory.create(
      challenge = challenge,
      deviceId = "routine_device_$fingerprint",
      identity = identity,
      issuedAt = utcFormatter.format(Instant.ofEpochMilli(requestIssued)),
      expiresAt = utcFormatter.format(Instant.ofEpochMilli(proofExpires)),
    )
    return RoutineDevicePairingJsonCodec.encode(proof)
  }
}

/** Bounded, duplicate-key-rejecting no-money proof wire shape. No network call is made here. */
internal object RoutineDevicePairingJsonCodec {
  private const val CHALLENGE_PACKAGE_PREFIX = "fetanagent-routine-pairing-v1."
  private val challengeKeys =
    setOf("contractVersion", "providerCode", "protocolMode", "pairingId", "pairingNonceDigest",
      "receiverRevisionId", "receiverVersion", "receiverProfileDigest", "expectedReceiverNameDigest",
      "issuedAt", "expiresAt")
  private val envelopeKeys =
    setOf("contractVersion", "providerCode", "protocolMode", "transcriptVersion",
      "bodyDigestAlgorithm", "bodyDigest", "signatureAlgorithm", "signatureEncoding", "body", "signature")
  private val bodyKeys =
    setOf("contractVersion", "providerCode", "protocolMode", "pairingId", "pairingNonceDigest",
      "receiverRevisionId", "receiverVersion", "receiverProfileDigest", "expectedReceiverNameDigest",
      "deviceId", "keyId", "devicePublicKeySpki", "devicePublicKeySpkiSha256", "issuedAt", "expiresAt")

  /** Decoding is structural only: the server must independently authenticate this challenge. */
  fun decodeChallengePackage(value: String): RoutineDevicePairingChallenge? =
    runCatching {
      require(value.length in (CHALLENGE_PACKAGE_PREFIX.length + 1)..1_024)
      require(value.startsWith(CHALLENGE_PACKAGE_PREFIX))
      val encoded = value.removePrefix(CHALLENGE_PACKAGE_PREFIX)
      require(Regex("^[A-Za-z0-9_-]+$").matches(encoded))
      val bytes = Base64.getUrlDecoder().decode(encoded)
      require(bytes.size in 1..768)
      require(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == encoded)
      val challenge = StrictJson.parse(bytes).requireObject(challengeKeys)
      RoutineDevicePairingChallenge(
        contractVersion = challenge.int("contractVersion"),
        providerCode = challenge.string("providerCode"),
        protocolMode = challenge.string("protocolMode"),
        pairingId = challenge.string("pairingId"),
        pairingNonceDigest = challenge.string("pairingNonceDigest"),
        receiverRevisionId = challenge.string("receiverRevisionId"),
        receiverVersion = challenge.int("receiverVersion"),
        receiverProfileDigest = challenge.string("receiverProfileDigest"),
        expectedReceiverNameDigest = challenge.string("expectedReceiverNameDigest"),
        issuedAt = challenge.string("issuedAt"),
        expiresAt = challenge.string("expiresAt"),
      )
    }.getOrNull()

  fun encode(proof: RoutineSignedDevicePairingProof): ByteArray {
    require(proof.bodyDigest == RoutineDevicePairingCanonical.bodyDigest(proof.body))
    val body = proof.body
    val bytes =
      StrictJson.encode(
          obj(
            "contractVersion" to number(proof.contractVersion.toLong()),
            "providerCode" to text(proof.providerCode),
            "protocolMode" to text(proof.protocolMode),
            "transcriptVersion" to text(proof.transcriptVersion),
            "bodyDigestAlgorithm" to text(proof.bodyDigestAlgorithm),
            "bodyDigest" to text(proof.bodyDigest),
            "signatureAlgorithm" to text(proof.signatureAlgorithm),
            "signatureEncoding" to text(proof.signatureEncoding),
            "body" to obj(
              "contractVersion" to number(body.contractVersion.toLong()),
              "providerCode" to text(body.providerCode),
              "protocolMode" to text(body.protocolMode),
              "pairingId" to text(body.pairingId),
              "pairingNonceDigest" to text(body.pairingNonceDigest),
              "receiverRevisionId" to text(body.receiverRevisionId),
              "receiverVersion" to number(body.receiverVersion.toLong()),
              "receiverProfileDigest" to text(body.receiverProfileDigest),
              "expectedReceiverNameDigest" to text(body.expectedReceiverNameDigest),
              "deviceId" to text(body.deviceId),
              "keyId" to text(body.keyId),
              "devicePublicKeySpki" to text(body.devicePublicKeySpki),
              "devicePublicKeySpkiSha256" to text(body.devicePublicKeySpkiSha256),
              "issuedAt" to text(body.issuedAt),
              "expiresAt" to text(body.expiresAt),
            ),
            "signature" to text(proof.signature),
          ),
        ).toByteArray(StandardCharsets.UTF_8)
    require(bytes.size in 1..4_096)
    return bytes
  }

  fun decode(bytes: ByteArray): RoutineSignedDevicePairingProof? =
    runCatching {
      require(bytes.size in 1..4_096)
      val envelope = StrictJson.parse(bytes).requireObject(envelopeKeys)
      val body = envelope.value("body").requireObject(bodyKeys)
      val parsedBody = RoutineDevicePairingBody(
        contractVersion = body.int("contractVersion"),
        providerCode = body.string("providerCode"),
        protocolMode = body.string("protocolMode"),
        pairingId = body.string("pairingId"),
        pairingNonceDigest = body.string("pairingNonceDigest"),
        receiverRevisionId = body.string("receiverRevisionId"),
        receiverVersion = body.int("receiverVersion"),
        receiverProfileDigest = body.string("receiverProfileDigest"),
        expectedReceiverNameDigest = body.string("expectedReceiverNameDigest"),
        deviceId = body.string("deviceId"),
        keyId = body.string("keyId"),
        devicePublicKeySpki = body.string("devicePublicKeySpki"),
        devicePublicKeySpkiSha256 = body.string("devicePublicKeySpkiSha256"),
        issuedAt = body.string("issuedAt"),
        expiresAt = body.string("expiresAt"),
      )
      RoutineSignedDevicePairingProof(
        contractVersion = envelope.int("contractVersion"),
        providerCode = envelope.string("providerCode"),
        protocolMode = envelope.string("protocolMode"),
        transcriptVersion = envelope.string("transcriptVersion"),
        bodyDigestAlgorithm = envelope.string("bodyDigestAlgorithm"),
        bodyDigest = envelope.string("bodyDigest"),
        signatureAlgorithm = envelope.string("signatureAlgorithm"),
        signatureEncoding = envelope.string("signatureEncoding"),
        body = parsedBody,
        signature = envelope.string("signature"),
      ).also { require(it.bodyDigest == RoutineDevicePairingCanonical.bodyDigest(it.body)) }
    }.getOrNull()
}
