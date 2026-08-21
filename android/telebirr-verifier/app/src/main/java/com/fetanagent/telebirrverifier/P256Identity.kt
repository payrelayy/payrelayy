package com.fetanagent.telebirrverifier

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

interface P256Identity {
  val keyId: String
  fun publicMaterial(): IdentityPublicMaterial
  fun signP1363(message: ByteArray): ByteArray
}

data class IdentityPublicMaterial(
  val keyId: String,
  val publicKeySpkiBase64Url: String,
  val publicKeySpkiSha256: String,
)

class AndroidKeystoreP256Identity(
  override val keyId: String,
  private val alias: String = "fetanagent_telebirr_relay_p256_v1",
) : P256Identity {
  init {
    RelayProtocol.requireOpaqueId(keyId, "keyId")
    require(Regex("^[A-Za-z0-9_.-]{8,96}$").matches(alias)) { "Unsafe Keystore alias" }
  }

  override fun publicMaterial(): IdentityPublicMaterial {
    ensureKey()
    val certificate = keyStore().getCertificate(alias) ?: error("Keystore certificate missing")
    val spki = certificate.publicKey.encoded ?: error("Public SPKI export unavailable")
    return IdentityPublicMaterial(
      keyId = keyId,
      publicKeySpkiBase64Url = Base64.getUrlEncoder().withoutPadding().encodeToString(spki),
      publicKeySpkiSha256 = CanonicalTranscripts.sha256(spki),
    )
  }

  override fun signP1363(message: ByteArray): ByteArray {
    ensureKey()
    val privateKey = keyStore().getKey(alias, null) ?: error("Keystore private key missing")
    val signer = Signature.getInstance("SHA256withECDSA")
    signer.initSign(privateKey as java.security.PrivateKey)
    signer.update(message)
    return EcdsaP1363.derToP1363(signer.sign())
  }

  private fun ensureKey() {
    if (keyStore().containsAlias(alias)) return
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    val specification =
      KeyGenParameterSpec.Builder(
          alias,
          KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(false)
        .build()
    generator.initialize(specification)
    generator.generateKeyPair()
  }

  private fun keyStore(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
}

object EcdsaP1363 {
  private const val FIELD_BYTES = 32

  fun derToP1363(der: ByteArray): ByteArray {
    var cursor = 0
    require(readByte(der, cursor++) == 0x30) { "ECDSA signature is not a DER sequence" }
    val sequenceLength = readLength(der, cursor)
    cursor = sequenceLength.next
    require(sequenceLength.length == der.size - cursor) { "Invalid DER sequence length" }
    val r = readInteger(der, cursor)
    cursor = r.next
    val s = readInteger(der, cursor)
    cursor = s.next
    require(cursor == der.size) { "Trailing bytes in DER signature" }
    return fixedUnsigned(r.bytes) + fixedUnsigned(s.bytes)
  }

  fun p1363ToDer(p1363: ByteArray): ByteArray {
    require(p1363.size == FIELD_BYTES * 2) { "P-256 P1363 signatures must be 64 bytes" }
    val r = positiveDerInteger(p1363.copyOfRange(0, FIELD_BYTES))
    val s = positiveDerInteger(p1363.copyOfRange(FIELD_BYTES, FIELD_BYTES * 2))
    val payload = byteArrayOf(0x02, r.size.toByte()) + r + byteArrayOf(0x02, s.size.toByte()) + s
    require(payload.size < 128)
    return byteArrayOf(0x30, payload.size.toByte()) + payload
  }

  private data class Length(val length: Int, val next: Int)
  private data class IntegerValue(val bytes: ByteArray, val next: Int)

  private fun readLength(bytes: ByteArray, offset: Int): Length {
    val first = readByte(bytes, offset)
    return when {
      first < 0x80 -> Length(first, offset + 1)
      first == 0x81 -> {
        val length = readByte(bytes, offset + 1)
        require(length >= 0x80) { "Non-canonical DER length" }
        Length(length, offset + 2)
      }
      else -> throw IllegalArgumentException("Unsupported DER length")
    }
  }

  private fun readInteger(bytes: ByteArray, offset: Int): IntegerValue {
    require(readByte(bytes, offset) == 0x02) { "Expected DER integer" }
    val length = readLength(bytes, offset + 1)
    require(length.length in 1..33 && length.next + length.length <= bytes.size)
    val value = bytes.copyOfRange(length.next, length.next + length.length)
    require(value[0].toInt() and 0x80 == 0) { "Negative DER integer" }
    require(value.size == 1 || value[0] != 0.toByte() || value[1].toInt() and 0x80 != 0) {
      "Non-canonical DER integer"
    }
    return IntegerValue(value, length.next + length.length)
  }

  private fun fixedUnsigned(integer: ByteArray): ByteArray {
    val unsigned = if (integer.size == 33 && integer[0] == 0.toByte()) integer.copyOfRange(1, 33) else integer
    require(unsigned.size <= FIELD_BYTES)
    return ByteArray(FIELD_BYTES - unsigned.size) + unsigned
  }

  private fun positiveDerInteger(fixed: ByteArray): ByteArray {
    var first = 0
    while (first < fixed.lastIndex && fixed[first] == 0.toByte()) first += 1
    val value = fixed.copyOfRange(first, fixed.size)
    return if (value[0].toInt() and 0x80 != 0) byteArrayOf(0) + value else value
  }

  private fun readByte(bytes: ByteArray, offset: Int): Int {
    require(offset in bytes.indices) { "Truncated DER signature" }
    return bytes[offset].toInt() and 0xff
  }
}

object SignedObservationFactory {
  fun create(body: RelayObservationBody, identity: P256Identity): SignedRelayObservation {
    require(identity.keyId == body.keyId) { "Observation key binding mismatch" }
    val bodyDigest = CanonicalTranscripts.observationBodyDigest(body)
    val signature = identity.signP1363(CanonicalTranscripts.signatureTranscriptBytes(bodyDigest))
    require(signature.size == 64) { "Signer did not produce a P-256 P1363 signature" }
    return SignedRelayObservation(
      contractVersion = RelayProtocol.CONTRACT_VERSION,
      providerCode = RelayProtocol.PROVIDER_CODE,
      protocolMode = RelayProtocol.PROTOCOL_MODE,
      transcriptVersion = RelayProtocol.TRANSCRIPT_VERSION,
      bodyDigestAlgorithm = RelayProtocol.BODY_DIGEST_ALGORITHM,
      bodyDigest = bodyDigest,
      signatureAlgorithm = RelayProtocol.SIGNATURE_ALGORITHM,
      signatureEncoding = RelayProtocol.SIGNATURE_ENCODING,
      body = body,
      signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signature),
    )
  }
}
