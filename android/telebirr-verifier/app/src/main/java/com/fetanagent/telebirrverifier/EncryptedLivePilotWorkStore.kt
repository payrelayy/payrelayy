package com.fetanagent.telebirrverifier

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Authenticated encryption boundary for sensitive durable verifier work. */
interface LivePilotQueueCipher {
  fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray

  fun open(sealed: ByteArray, associatedData: ByteArray): ByteArray
}

/**
 * Android Keystore AES-GCM key. The key is non-exportable and the queue lives below
 * [Context.getNoBackupFilesDir], so neither a cloud backup nor ordinary preferences contains a raw
 * TeleBirr reference, receiver name, assignment, or signed observation.
 */
class AndroidKeystoreLivePilotQueueCipher(
  private val alias: String = KEY_ALIAS,
) : LivePilotQueueCipher {
  init {
    require(Regex("^[A-Za-z0-9_.-]{8,96}$").matches(alias))
  }

  override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray {
    require(plaintext.size in 1..MAX_PLAINTEXT_BYTES)
    require(associatedData.size in 1..MAX_ASSOCIATED_DATA_BYTES)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val nonce = cipher.iv
    require(nonce.size == NONCE_BYTES)
    cipher.updateAAD(associatedData)
    val ciphertext = cipher.doFinal(plaintext)
    require(ciphertext.size == plaintext.size + TAG_BYTES)
    return ByteArrayOutputStream(SEALED_MAGIC.size + 1 + nonce.size + ciphertext.size).use {
      DataOutputStream(it).use { output ->
        output.write(SEALED_MAGIC)
        output.writeByte(nonce.size)
        output.write(nonce)
        output.write(ciphertext)
      }
      it.toByteArray()
    }
  }

  override fun open(sealed: ByteArray, associatedData: ByteArray): ByteArray {
    require(
      sealed.size in (SEALED_MAGIC.size + 1 + NONCE_BYTES + TAG_BYTES + 1)..MAX_SEALED_BYTES,
    )
    require(associatedData.size in 1..MAX_ASSOCIATED_DATA_BYTES)
    val input = DataInputStream(ByteArrayInputStream(sealed))
    val magic = ByteArray(SEALED_MAGIC.size).also(input::readFully)
    require(magic.contentEquals(SEALED_MAGIC))
    val nonceLength = input.readUnsignedByte()
    require(nonceLength == NONCE_BYTES)
    val nonce = ByteArray(nonceLength).also(input::readFully)
    val ciphertext = input.readBytes()
    require(ciphertext.size in (TAG_BYTES + 1)..(MAX_PLAINTEXT_BYTES + TAG_BYTES))
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, nonce))
    cipher.updateAAD(associatedData)
    return cipher.doFinal(ciphertext).also { require(it.size in 1..MAX_PLAINTEXT_BYTES) }
  }

  @Synchronized
  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
          alias,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .setUserAuthenticationRequired(false)
        .build(),
    )
    return generator.generateKey()
  }

  override fun toString(): String = "AndroidKeystoreLivePilotQueueCipher(<non-exportable>)"

  companion object {
    const val KEY_ALIAS = "fetanagent_telebirr_live_pilot_queue_aes_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val NONCE_BYTES = 12
    private const val TAG_BITS = 128
    private const val TAG_BYTES = TAG_BITS / 8
    private const val MAX_PLAINTEXT_BYTES = 384 * 1_024
    private const val MAX_ASSOCIATED_DATA_BYTES = 256
    private const val MAX_SEALED_BYTES = MAX_PLAINTEXT_BYTES + 64
    private val SEALED_MAGIC = "FETAQG01".toByteArray(StandardCharsets.US_ASCII)
  }
}

/**
 * Crash-safe, encrypted implementation of the runtime replay/queue boundary. Each assignment
 * digest is one atomic record. Pending evidence survives process death and reboot with the exact
 * original signatures; acknowledged and rejected tombstones prevent the same assignment from
 * being observed again.
 */
class EncryptedFileLivePilotWorkStore(
  directory: File,
  private val cipher: LivePilotQueueCipher,
  private val maximumRecords: Int = DEFAULT_MAXIMUM_RECORDS,
) : LivePilotWorkStore {
  private val directory = directory.absoluteFile

  init {
    require(maximumRecords in 1..1_024)
    prepareDirectory()
    recoverInterruptedClaims()
  }

  @Synchronized
  override fun nextPending(): LivePilotPendingUpload? {
    for (file in recordFiles()) {
      when (val record = readRecord(file)) {
        is StoredRecord.Pending -> return record.upload
        StoredRecord.InFlight -> error("Interrupted claim was not recovered")
        StoredRecord.Acknowledged,
        is StoredRecord.Rejected,
        -> Unit
      }
    }
    return null
  }

  @Synchronized
  override fun claim(assignmentBodyDigest: String): LivePilotWorkClaim {
    val file = recordFile(assignmentBodyDigest)
    if (!file.exists()) {
      require(recordFiles().size < maximumRecords) { "Encrypted work-store capacity reached" }
      writeRecord(file, assignmentBodyDigest, StoredRecord.InFlight)
      return LivePilotWorkClaim.Acquired
    }
    return when (val record = readRecord(file)) {
      StoredRecord.InFlight -> LivePilotWorkClaim.Busy
      StoredRecord.Acknowledged -> LivePilotWorkClaim.Acknowledged
      is StoredRecord.Pending -> LivePilotWorkClaim.Pending(record.upload)
      is StoredRecord.Rejected -> LivePilotWorkClaim.Rejected(record.reason)
    }
  }

  @Synchronized
  override fun stage(
    assignmentBodyDigest: String,
    assignment: LivePilotSignedAssignment,
    observation: LivePilotSignedObservation,
  ) {
    val file = recordFile(assignmentBodyDigest)
    require(readRecord(file) == StoredRecord.InFlight)
    require(assignment.bodyDigest == assignmentBodyDigest)
    require(observation.body.assignmentBodyDigest == assignmentBodyDigest)
    writeRecord(
      file,
      assignmentBodyDigest,
      StoredRecord.Pending(LivePilotPendingUpload(assignment, observation)),
    )
  }

  @Synchronized
  override fun acknowledge(assignmentBodyDigest: String, observationBodyDigest: String) {
    LivePrivatePilotProtocol.requireSha256(observationBodyDigest, "observationBodyDigest")
    val file = recordFile(assignmentBodyDigest)
    val pending = readRecord(file) as? StoredRecord.Pending
      ?: error("No staged observation")
    require(pending.upload.observation.bodyDigest == observationBodyDigest)
    writeRecord(file, assignmentBodyDigest, StoredRecord.Acknowledged)
  }

  @Synchronized
  override fun reject(assignmentBodyDigest: String, reason: LivePilotUploadRejection) {
    val file = recordFile(assignmentBodyDigest)
    require(readRecord(file) is StoredRecord.Pending)
    writeRecord(file, assignmentBodyDigest, StoredRecord.Rejected(reason))
  }

  @Synchronized
  override fun release(assignmentBodyDigest: String) {
    val file = recordFile(assignmentBodyDigest)
    if (!file.exists()) return
    if (readRecord(file) == StoredRecord.InFlight) {
      check(file.delete()) { "Unable to release encrypted work claim" }
    }
  }

  private fun prepareDirectory() {
    val parent = requireNotNull(directory.parentFile).absoluteFile
    require(parent.exists() && parent.isDirectory)
    require(!Files.isSymbolicLink(parent.toPath()))
    if (!directory.exists()) check(directory.mkdir()) { "Unable to create encrypted work directory" }
    require(directory.isDirectory && !Files.isSymbolicLink(directory.toPath()))
    require(directory.canonicalFile.parentFile == parent.canonicalFile)
    restrictOwnerAccess(directory, executable = true)
    directory.listFiles()?.forEach { file ->
      if (TEMP_FILE_PATTERN.matches(file.name)) {
        require(file.isFile && !Files.isSymbolicLink(file.toPath()))
        check(file.delete()) { "Unable to remove interrupted encrypted work write" }
      }
    } ?: error("Unable to inspect encrypted work directory")
  }

  private fun recoverInterruptedClaims() {
    for (file in recordFiles()) {
      if (readRecord(file) == StoredRecord.InFlight) {
        check(file.delete()) { "Unable to recover interrupted encrypted work claim" }
      }
    }
  }

  private fun recordFiles(): List<File> {
    val files = directory.listFiles()?.toList() ?: error("Unable to inspect encrypted work directory")
    require(files.size <= maximumRecords)
    return files
      .onEach { file ->
        require(RECORD_FILE_PATTERN.matches(file.name)) { "Unexpected encrypted work-store entry" }
        require(file.isFile && !Files.isSymbolicLink(file.toPath()))
        require(file.canonicalFile.parentFile == directory.canonicalFile)
        require(file.length() in 1..MAX_RECORD_FILE_BYTES.toLong())
      }
      .sortedBy(File::getName)
  }

  private fun recordFile(assignmentBodyDigest: String): File {
    LivePrivatePilotProtocol.requireSha256(assignmentBodyDigest, "assignmentBodyDigest")
    val digest = assignmentBodyDigest.removePrefix("sha256:")
    val file = File(directory, "$digest.record").absoluteFile
    require(file.parentFile == directory)
    return file
  }

  private fun readRecord(file: File): StoredRecord {
    require(file.exists() && file.isFile && !Files.isSymbolicLink(file.toPath()))
    require(file.length() in 1..MAX_RECORD_FILE_BYTES.toLong())
    val digest = "sha256:${file.name.removeSuffix(".record")}".also {
      LivePrivatePilotProtocol.requireSha256(it, "assignmentBodyDigest")
    }
    val sealed = file.inputStream().use { input -> input.readBytes() }
    require(sealed.size in 1..MAX_RECORD_FILE_BYTES)
    return decodeRecord(cipher.open(sealed, associatedData(digest)))
  }

  private fun writeRecord(file: File, digest: String, record: StoredRecord) {
    val plaintext = encodeRecord(record)
    val sealed = cipher.seal(plaintext, associatedData(digest))
    require(sealed.size in 1..MAX_RECORD_FILE_BYTES)
    val temporary = File(directory, ".tmp-${UUID.randomUUID()}").absoluteFile
    require(temporary.parentFile == directory && !temporary.exists())
    try {
      FileOutputStream(temporary).use { output ->
        output.write(sealed)
        output.fd.sync()
      }
      restrictOwnerAccess(temporary, executable = false)
      try {
        Files.move(
          temporary.toPath(),
          file.toPath(),
          StandardCopyOption.ATOMIC_MOVE,
          StandardCopyOption.REPLACE_EXISTING,
        )
      } catch (failure: AtomicMoveNotSupportedException) {
        throw IllegalStateException("Encrypted work store requires atomic replacement", failure)
      }
      require(file.isFile && !Files.isSymbolicLink(file.toPath()))
    } finally {
      if (temporary.exists()) temporary.delete()
      plaintext.fill(0)
      sealed.fill(0)
    }
  }

  private fun encodeRecord(record: StoredRecord): ByteArray {
    val payload =
      when (record) {
        StoredRecord.InFlight,
        StoredRecord.Acknowledged,
        -> byteArrayOf()
        is StoredRecord.Pending -> DeviceBridgeJsonCodec.encodePendingUpload(record.upload)
        is StoredRecord.Rejected -> record.reason.code.toByteArray(StandardCharsets.US_ASCII)
      }
    require(payload.size <= MAX_RECORD_PAYLOAD_BYTES)
    return ByteArrayOutputStream(RECORD_MAGIC.size + 1 + 4 + payload.size).use {
      DataOutputStream(it).use { output ->
        output.write(RECORD_MAGIC)
        output.writeByte(record.code)
        output.writeInt(payload.size)
        output.write(payload)
      }
      it.toByteArray()
    }
  }

  private fun decodeRecord(bytes: ByteArray): StoredRecord {
    require(bytes.size in (RECORD_MAGIC.size + 1 + 4)..MAX_RECORD_PLAINTEXT_BYTES)
    val input = DataInputStream(ByteArrayInputStream(bytes))
    val magic = ByteArray(RECORD_MAGIC.size).also(input::readFully)
    require(magic.contentEquals(RECORD_MAGIC))
    val code = input.readUnsignedByte()
    val payloadLength = input.readInt()
    require(payloadLength in 0..MAX_RECORD_PAYLOAD_BYTES)
    val payload = ByteArray(payloadLength).also(input::readFully)
    require(input.read() == -1)
    return when (code) {
      StoredRecord.InFlight.code -> {
        require(payload.isEmpty())
        StoredRecord.InFlight
      }
      StoredRecord.Acknowledged.code -> {
        require(payload.isEmpty())
        StoredRecord.Acknowledged
      }
      StoredRecord.Pending.CODE ->
        StoredRecord.Pending(requireNotNull(DeviceBridgeJsonCodec.decodePendingUpload(payload)))
      StoredRecord.Rejected.CODE -> {
        val reasonCode = payload.toString(StandardCharsets.US_ASCII)
        val reason = LivePilotUploadRejection.values().singleOrNull { it.code == reasonCode }
        StoredRecord.Rejected(requireNotNull(reason))
      }
      else -> error("Unknown encrypted work record state")
    }
  }

  private fun associatedData(digest: String): ByteArray =
    "fetanagent:android:live-pilot-work-store:v1:$digest"
      .toByteArray(StandardCharsets.US_ASCII)

  private fun restrictOwnerAccess(file: File, executable: Boolean) {
    // Windows' java.io.File permission setters cannot express POSIX owner-only modes and may
    // report a false failure after successfully toggling the DOS read-only bit. Android reports
    // Linux here; enforce owner-only access on the production platform and Linux CI.
    if (System.getProperty("os.name").orEmpty().startsWith("Windows", ignoreCase = true)) return
    check(file.setReadable(false, false)) { "Unable to clear encrypted work read access" }
    check(file.setWritable(false, false)) { "Unable to clear encrypted work write access" }
    check(file.setExecutable(false, false)) { "Unable to clear encrypted work execute access" }
    check(file.setReadable(true, true)) { "Unable to restrict encrypted work read access" }
    check(file.setWritable(true, true)) { "Unable to restrict encrypted work write access" }
    if (executable) {
      check(file.setExecutable(true, true)) { "Unable to restrict encrypted work execute access" }
    }
  }

  override fun toString(): String = "EncryptedFileLivePilotWorkStore(<redacted>)"

  private sealed interface StoredRecord {
    val code: Int

    data object InFlight : StoredRecord {
      override val code = 1
    }

    data class Pending(val upload: LivePilotPendingUpload) : StoredRecord {
      override val code = CODE

      companion object {
        const val CODE = 2
      }

      override fun toString(): String = "StoredRecord.Pending(<redacted>)"
    }

    data object Acknowledged : StoredRecord {
      override val code = 3
    }

    data class Rejected(val reason: LivePilotUploadRejection) : StoredRecord {
      override val code = CODE

      companion object {
        const val CODE = 4
      }
    }
  }

  companion object {
    private const val DEFAULT_MAXIMUM_RECORDS = 256
    private const val MAX_RECORD_PAYLOAD_BYTES = 320 * 1_024
    private const val MAX_RECORD_PLAINTEXT_BYTES = MAX_RECORD_PAYLOAD_BYTES + 64
    private const val MAX_RECORD_FILE_BYTES = MAX_RECORD_PLAINTEXT_BYTES + 128
    private val RECORD_MAGIC = "FETAWR01".toByteArray(StandardCharsets.US_ASCII)
    private val RECORD_FILE_PATTERN = Regex("^[a-f0-9]{64}\\.record$")
    private val TEMP_FILE_PATTERN = Regex("^\\.tmp-[0-9a-f-]{36}$")

    fun forApplication(context: Context): EncryptedFileLivePilotWorkStore =
      EncryptedFileLivePilotWorkStore(
        directory = File(context.applicationContext.noBackupFilesDir, "telebirr-live-pilot-queue-v1"),
        cipher = AndroidKeystoreLivePilotQueueCipher(),
      )
  }
}
