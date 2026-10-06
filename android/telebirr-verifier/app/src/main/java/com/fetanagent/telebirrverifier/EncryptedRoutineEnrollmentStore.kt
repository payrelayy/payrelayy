package com.fetanagent.telebirrverifier

import android.content.Context
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/** Distinct from every pilot and bridge provisioning record. No receipt grants a network action. */
internal sealed interface RoutineEnrollmentState {
  data class Pending(val proof: RoutineSignedDevicePairingProof) : RoutineEnrollmentState {
    override fun toString(): String = "RoutineEnrollmentState.Pending(<redacted>)"
  }
  data class Enrolled(
    val proof: RoutineSignedDevicePairingProof?,
    val receipt: RoutineSignedEnrollmentReceipt,
  ) : RoutineEnrollmentState {
    override fun toString(): String = "RoutineEnrollmentState.Enrolled(<redacted>)"
  }
}

/** Crash-safe, Keystore-sealed pending proof and eventual signed receipt in no-backup storage. */
internal class EncryptedRoutineEnrollmentStore(
  directory: File,
  private val cipher: LivePilotQueueCipher,
) {
  private val directory = directory.absoluteFile
  private val stateFile = File(this.directory, "routine-enrollment.sealed").absoluteFile

  init { prepareDirectory() }

  @Synchronized
  fun stagePending(proof: RoutineSignedDevicePairingProof, identity: P256Identity, nowMillis: Long) {
    require(nowMillis < java.time.Instant.parse(proof.body.expiresAt).toEpochMilli())
    requireValidLocalProof(proof, identity)
    when (val existing = read()) {
      is RoutineEnrollmentState.Enrolled -> error("A routine enrollment already exists")
      is RoutineEnrollmentState.Pending -> {
        if (existing.proof == proof) return
        require(nowMillis >= java.time.Instant.parse(existing.proof.body.expiresAt).toEpochMilli()) {
          "A fresh routine proof is already pending"
        }
      }
      null -> Unit
    }
    write(RoutineEnrollmentState.Pending(proof))
  }

  @Synchronized
  fun loadPending(identity: P256Identity, nowMillis: Long): RoutineSignedDevicePairingProof? {
    val pending = read() as? RoutineEnrollmentState.Pending ?: return null
    requireValidLocalProof(pending.proof, identity)
    return pending.proof.takeIf {
      nowMillis < java.time.Instant.parse(it.body.expiresAt).toEpochMilli()
    }
  }

  @Synchronized
  fun complete(
    receipt: RoutineSignedEnrollmentReceipt,
    signer: RoutineEnrollmentTrustedSigner,
    identity: P256Identity,
    assessedAt: String,
  ) {
    val pending = read() as? RoutineEnrollmentState.Pending ?: error("No pending routine proof")
    requireValidLocalProof(pending.proof, identity)
    require(RoutineEnrollmentReceiptProtocol.verify(
      receipt, signer, RoutineEnrollmentExpectedBinding.fromPairingProof(pending.proof),
      identity.publicMaterial(), assessedAt,
    )) { "Routine enrollment receipt is not authenticated" }
    write(RoutineEnrollmentState.Enrolled(pending.proof, receipt))
  }

  /** Recovers an already Owner-enrolled phone that has no locally staged pending proof. */
  @Synchronized
  fun recoverExisting(
    receipt: RoutineSignedEnrollmentReceipt,
    signer: RoutineEnrollmentTrustedSigner,
    identity: P256Identity,
    assessedAt: String,
  ) {
    require(RoutineEnrollmentReceiptProtocol.verifyExistingLocalKey(
      receipt, signer, identity.publicMaterial(), assessedAt,
    )) { "Routine enrollment receipt is not authenticated for this phone" }
    when (val existing = read()) {
      is RoutineEnrollmentState.Pending -> error("A pending routine proof must be completed normally")
      is RoutineEnrollmentState.Enrolled -> {
        require(existing.receipt.body.enrollmentId == receipt.body.enrollmentId &&
          existing.receipt.body.pairingEvidenceDigest == receipt.body.pairingEvidenceDigest &&
          existing.receipt.body.keyId == receipt.body.keyId) {
          "A different routine enrollment already exists"
        }
        if (existing.receipt == receipt) return
      }
      null -> Unit
    }
    write(RoutineEnrollmentState.Enrolled(null, receipt))
  }

  @Synchronized
  fun acceptSignedReceipt(
    receipt: RoutineSignedEnrollmentReceipt,
    signer: RoutineEnrollmentTrustedSigner,
    identity: P256Identity,
    assessedAt: String,
  ) {
    if (read() is RoutineEnrollmentState.Pending) {
      complete(receipt, signer, identity, assessedAt)
    } else {
      recoverExisting(receipt, signer, identity, assessedAt)
    }
  }

  @Synchronized
  fun loadEnrolled(
    signer: RoutineEnrollmentTrustedSigner,
    identity: P256Identity,
    assessedAt: String,
  ): RoutineSignedEnrollmentReceipt? {
    val enrolled = read() as? RoutineEnrollmentState.Enrolled ?: return null
    enrolled.proof?.let { requireValidLocalProof(it, identity) }
    return enrolled.receipt.takeIf {
      if (enrolled.proof != null) RoutineEnrollmentReceiptProtocol.verify(
        it, signer, RoutineEnrollmentExpectedBinding.fromPairingProof(enrolled.proof),
        identity.publicMaterial(), assessedAt,
      ) else RoutineEnrollmentReceiptProtocol.verifyExistingLocalKey(
        it, signer, identity.publicMaterial(), assessedAt,
      )
    }
  }

  private fun requireValidLocalProof(proof: RoutineSignedDevicePairingProof, identity: P256Identity) {
    val body = proof.body
    val material = identity.publicMaterial()
    require(body.keyId == material.keyId && body.keyId == identity.keyId)
    require(body.devicePublicKeySpki == material.publicKeySpkiBase64Url)
    require(body.devicePublicKeySpkiSha256 == material.publicKeySpkiSha256)
    require(proof.bodyDigest == RoutineDevicePairingCanonical.bodyDigest(body))
    require(DeviceBridgeCrypto.verifyP1363(
      DeviceBridgeCrypto.parseP256SpkiBase64Url(body.devicePublicKeySpki),
      RoutineDevicePairingCanonical.signatureBytes(body), proof.signature,
    ))
  }

  private fun prepareDirectory() {
    val parent = requireNotNull(directory.parentFile).absoluteFile
    require(parent.exists() && parent.isDirectory && !Files.isSymbolicLink(parent.toPath()))
    if (!directory.exists()) check(directory.mkdir())
    require(directory.isDirectory && !Files.isSymbolicLink(directory.toPath()))
    require(directory.canonicalFile.parentFile == parent.canonicalFile)
    restrictOwnerAccess(directory, executable = true)
    directory.listFiles()?.forEach { file ->
      if (TEMP_FILE.matches(file.name)) {
        require(file.isFile && !Files.isSymbolicLink(file.toPath()))
        check(file.delete())
      }
    } ?: error("Unable to inspect routine enrollment directory")
    inspectDirectory()
  }

  private fun inspectDirectory() {
    val files = directory.listFiles()?.toList() ?: error("Unable to inspect routine enrollment directory")
    require(files.size <= 1)
    files.forEach { file ->
      require(file == stateFile && file.isFile && !Files.isSymbolicLink(file.toPath()))
      require(file.canonicalFile.parentFile == directory.canonicalFile)
    }
  }

  private fun read(): RoutineEnrollmentState? {
    inspectDirectory()
    if (!stateFile.exists()) return null
    require(stateFile.length() in 1..MAX_SEALED_BYTES.toLong())
    val sealed = stateFile.inputStream().use { it.readBytes() }
    val plaintext = cipher.open(sealed, ASSOCIATED_DATA)
    try {
      require(plaintext.size in 1..MAX_PLAINTEXT_BYTES)
      DataInputStream(ByteArrayInputStream(plaintext)).use { input ->
        val magic = ByteArray(MAGIC.size).also(input::readFully)
        require(magic.contentEquals(MAGIC))
        val stateCode = input.readUnsignedByte()
        val proofLength = input.readInt()
        require(proofLength in 0..MAX_COMPONENT_BYTES)
        val proof = ByteArray(proofLength).also(input::readFully)
        val receiptLength = input.readInt()
        require(receiptLength in 0..MAX_COMPONENT_BYTES)
        val receipt = ByteArray(receiptLength).also(input::readFully)
        require(input.read() == -1)
        return when (stateCode) {
          1 -> {
            require(proof.isNotEmpty() && receipt.isEmpty())
            RoutineEnrollmentState.Pending(requireNotNull(RoutineDevicePairingJsonCodec.decode(proof)))
          }
          2 -> {
            require(proof.isNotEmpty() && receipt.isNotEmpty())
            RoutineEnrollmentState.Enrolled(
              requireNotNull(RoutineDevicePairingJsonCodec.decode(proof)),
              requireNotNull(RoutineEnrollmentReceiptJsonCodec.decode(receipt)),
            )
          }
          3 -> {
            require(proof.isEmpty() && receipt.isNotEmpty())
            RoutineEnrollmentState.Enrolled(
              null, requireNotNull(RoutineEnrollmentReceiptJsonCodec.decode(receipt)),
            )
          }
          else -> error("Unknown routine enrollment state")
        }
      }
    } finally {
      sealed.fill(0)
      plaintext.fill(0)
    }
  }

  private fun write(state: RoutineEnrollmentState) {
    val proof = (when (state) {
      is RoutineEnrollmentState.Pending -> state.proof
      is RoutineEnrollmentState.Enrolled -> state.proof
    })?.let(RoutineDevicePairingJsonCodec::encode) ?: ByteArray(0)
    val receipt = when (state) {
      is RoutineEnrollmentState.Pending -> ByteArray(0)
      is RoutineEnrollmentState.Enrolled -> RoutineEnrollmentReceiptJsonCodec.encode(state.receipt)
    }
    val plaintext = ByteArrayOutputStream().use { bytes ->
      DataOutputStream(bytes).use { output ->
        output.write(MAGIC)
        output.writeByte(when (state) {
          is RoutineEnrollmentState.Pending -> 1
          is RoutineEnrollmentState.Enrolled -> if (state.proof == null) 3 else 2
        })
        output.writeInt(proof.size)
        output.write(proof)
        output.writeInt(receipt.size)
        output.write(receipt)
      }
      bytes.toByteArray()
    }
    require(plaintext.size in 1..MAX_PLAINTEXT_BYTES)
    val sealed = cipher.seal(plaintext, ASSOCIATED_DATA)
    require(sealed.size in 1..MAX_SEALED_BYTES)
    val temporary = File(directory, ".routine-enrollment-${UUID.randomUUID()}.tmp").absoluteFile
    require(temporary.parentFile == directory && !temporary.exists())
    try {
      FileOutputStream(temporary).use { output ->
        output.write(sealed)
        output.fd.sync()
      }
      restrictOwnerAccess(temporary, executable = false)
      Files.move(temporary.toPath(), stateFile.toPath(),
        StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
      restrictOwnerAccess(stateFile, executable = false)
    } finally {
      if (temporary.exists()) temporary.delete()
      plaintext.fill(0)
      sealed.fill(0)
      proof.fill(0)
      receipt.fill(0)
    }
  }

  private fun restrictOwnerAccess(file: File, executable: Boolean) {
    if (System.getProperty("os.name").orEmpty().startsWith("Windows", ignoreCase = true)) return
    check(file.setReadable(false, false))
    check(file.setWritable(false, false))
    check(file.setExecutable(false, false))
    check(file.setReadable(true, true))
    check(file.setWritable(true, true))
    if (executable) check(file.setExecutable(true, true))
  }

  companion object {
    private val MAGIC = "FETARU01".toByteArray(StandardCharsets.US_ASCII)
    private val TEMP_FILE = Regex("^\\.routine-enrollment-[0-9a-f-]{36}\\.tmp$")
    private val ASSOCIATED_DATA =
      "fetanagent:android:routine-enrollment:v1".toByteArray(StandardCharsets.US_ASCII)
    private const val MAX_COMPONENT_BYTES = 4_096
    private const val MAX_PLAINTEXT_BYTES = 8 + 1 + 4 + MAX_COMPONENT_BYTES + 4 + MAX_COMPONENT_BYTES
    private const val MAX_SEALED_BYTES = MAX_PLAINTEXT_BYTES + 128

    fun forApplication(context: Context): EncryptedRoutineEnrollmentStore =
      EncryptedRoutineEnrollmentStore(
        File(context.applicationContext.noBackupFilesDir, "routine-enrollment-v1"),
        AndroidKeystoreLivePilotQueueCipher("fetanagent_telebirr_routine_enrollment_aes_v1"),
      )
  }
}
