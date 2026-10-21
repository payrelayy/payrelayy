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
import java.security.MessageDigest
import java.util.UUID

/** A payment SMS stays sealed on the phone until the server acknowledges its signed event. */
internal class ReceiverSmsEncryptedOutbox(
  root: File,
  private val cipher: LivePilotQueueCipher,
  private val maximumPending: Int = 512,
) {
  internal class InitializationFailure(val code: String) : IllegalStateException(code)

  internal class Pending(
    val key: String,
    val message: ReceiverSmsSignedObservation.Message,
  ) {
    override fun toString(): String = "ReceiverSmsEncryptedOutbox.Pending(<redacted>)"
  }

  private val directory = root.absoluteFile

  init {
    require(maximumPending in 1..1_024)
    if (!directory.exists() && !directory.mkdirs())
      throw InitializationFailure("sms_queue_create_failed")
    if (!directory.isDirectory || Files.isSymbolicLink(directory.toPath()))
      throw InitializationFailure("sms_queue_path_invalid")
    // Android may expose noBackupFilesDir through a canonicalized parent path.
    // Keep the queue inside that private directory without requiring both path spellings to match.
    val parent = directory.parentFile ?: throw InitializationFailure("sms_queue_path_invalid")
    if (directory.canonicalFile.parentFile != parent.canonicalFile)
      throw InitializationFailure("sms_queue_path_invalid")
    directory.listFiles()?.filter { TEMP.matches(it.name) }?.forEach {
      require(it.isFile && !Files.isSymbolicLink(it.toPath()))
      check(it.delete())
    } ?: throw InitializationFailure("sms_queue_list_failed")
    directory.listFiles()?.filter { RECORD_PENDING.matches(it.name) }?.forEach { pending ->
      val key = pending.name.removeSuffix(".sealed")
      if (acknowledgedFile(key).exists() || reviewFile(key).exists()) {
        check(pending.delete())
      }
    } ?: throw InitializationFailure("sms_queue_list_failed")
    pruneOldAcknowledgements()
    inspectFiles()
  }

  @Synchronized
  fun stage(message: ReceiverSmsSignedObservation.Message): String {
    pruneOldAcknowledgements()
    require(message.subscriptionId >= -1)
    val bodyBytes = message.body.toByteArray(StandardCharsets.UTF_8)
    require(bodyBytes.size in 40..2_048)
    require(message.receivedAtMillis > 0)
    val key = digest(message, bodyBytes)
    val file = pendingFile(key)
    if (file.exists() || acknowledgedFile(key).exists() || reviewFile(key).exists()) return key
    val pending = pendingFiles()
    check(pending.size < maximumPending) { "Receiver SMS queue is full" }
    val plaintext = ByteArrayOutputStream().use { bytes ->
      DataOutputStream(bytes).use { output ->
        output.write(MAGIC)
        output.writeInt(message.subscriptionId)
        output.writeLong(message.receivedAtMillis)
        output.writeInt(bodyBytes.size)
        output.write(bodyBytes)
      }
      bytes.toByteArray()
    }
    try {
      val sealed = cipher.seal(plaintext, associatedData(key))
      require(sealed.size in 1..MAX_SEALED_BYTES)
      val temporary = File(directory, "$key-${UUID.randomUUID()}.tmp")
      try {
        FileOutputStream(temporary).use { output ->
          output.write(sealed)
          output.fd.sync()
        }
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE)
      } finally {
        if (temporary.exists()) check(temporary.delete())
        sealed.fill(0)
      }
    } finally {
      plaintext.fill(0)
      bodyBytes.fill(0)
    }
    return key
  }

  @Synchronized
  fun nextPending(): Pending? {
    for (file in pendingFiles()) {
      val key = file.name.removeSuffix(".sealed")
      val sealed = file.readBytes()
      require(sealed.size in 1..MAX_SEALED_BYTES)
      val plaintext = try { cipher.open(sealed, associatedData(key)) }
        finally { sealed.fill(0) }
      try {
        DataInputStream(ByteArrayInputStream(plaintext)).use { input ->
          val magic = ByteArray(MAGIC.size).also(input::readFully)
          require(magic.contentEquals(MAGIC))
          val subscriptionId = input.readInt()
          val receivedAt = input.readLong()
          val bodySize = input.readInt()
          require(subscriptionId >= -1 && receivedAt > 0 && bodySize in 40..2_048)
          val body = ByteArray(bodySize).also(input::readFully)
          require(input.read() == -1)
          try {
            val message = ReceiverSmsSignedObservation.Message(subscriptionId, receivedAt,
              String(body, StandardCharsets.UTF_8))
            require(digest(message, body) == key)
            return Pending(key, message)
          } finally { body.fill(0) }
        }
      } finally { plaintext.fill(0) }
    }
    return null
  }

  @Synchronized
  fun acknowledge(key: String) {
    closeRecord(key, acknowledgedFile(key))
  }

  @Synchronized
  fun archiveForReview(key: String) {
    val file = pendingFile(key)
    require(file.isFile)
    val reviewed = reviewFile(key)
    require(!reviewed.exists())
    Files.move(file.toPath(), reviewed.toPath(), StandardCopyOption.ATOMIC_MOVE)
  }

  private fun closeRecord(key: String, tombstone: File) {
    val file = pendingFile(key)
    require(file.isFile)
    require(!tombstone.exists())
    val temporary = File(directory, "$key-${UUID.randomUUID()}.tmp")
    try {
      FileOutputStream(temporary).use { output ->
        output.write(1)
        output.fd.sync()
      }
      Files.move(temporary.toPath(), tombstone.toPath(), StandardCopyOption.ATOMIC_MOVE)
      check(file.delete())
    } finally {
      if (temporary.exists()) check(temporary.delete())
    }
  }

  @Synchronized
  fun pendingCount(): Int = pendingFiles().size

  private fun pendingFiles(): List<File> = inspectFiles()
    .filter { RECORD_PENDING.matches(it.name) }
    .sortedWith(compareBy<File> { it.lastModified() }.thenBy { it.name })

  private fun pruneOldAcknowledgements() {
    val cutoff = System.currentTimeMillis() - ACK_RETENTION_MILLIS
    directory.listFiles()?.filter { it.name.endsWith(".ack") }?.forEach { ack ->
      require(ack.isFile && !Files.isSymbolicLink(ack.toPath()) &&
        RECORD.matches(ack.name) && ack.length() == 1L &&
        ack.canonicalFile.parentFile == directory.canonicalFile)
      if (ack.lastModified() < cutoff) check(ack.delete())
    } ?: error("Receiver SMS queue is unavailable")
  }

  private fun inspectFiles(): List<File> {
    val files = directory.listFiles()?.toList() ?: error("Receiver SMS queue is unavailable")
    require(files.size <= 2_048)
    files.forEach { file ->
      require(file.isFile && !Files.isSymbolicLink(file.toPath()))
      require(file.canonicalFile.parentFile == directory.canonicalFile)
      require(RECORD.matches(file.name))
      require(if (file.name.endsWith(".ack")) file.length() == 1L
        else file.length() in 1..MAX_SEALED_BYTES.toLong())
    }
    return files.sortedBy { it.name }
  }

  private fun pendingFile(key: String): File {
    require(DIGEST.matches(key))
    return File(directory, "$key.sealed")
  }

  private fun acknowledgedFile(key: String): File {
    require(DIGEST.matches(key))
    return File(directory, "$key.ack")
  }

  private fun reviewFile(key: String): File {
    require(DIGEST.matches(key))
    return File(directory, "$key.review.sealed")
  }

  private fun associatedData(key: String): ByteArray =
    "fetanagent:receiver-sms-outbox:v1:$key".toByteArray(StandardCharsets.US_ASCII)

  private fun digest(message: ReceiverSmsSignedObservation.Message, body: ByteArray): String {
    val hash = MessageDigest.getInstance("SHA-256")
    hash.update("fetanagent:receiver-sms-outbox-key:v1".toByteArray(StandardCharsets.US_ASCII))
    hash.update(0.toByte())
    hash.update(message.subscriptionId.toString().toByteArray(StandardCharsets.US_ASCII))
    hash.update(0.toByte())
    hash.update(message.receivedAtMillis.toString().toByteArray(StandardCharsets.US_ASCII))
    hash.update(0.toByte())
    hash.update(body)
    return hash.digest().joinToString("") { "%02x".format(it) }
  }

  companion object {
    private val MAGIC = "FETASMS1".toByteArray(StandardCharsets.US_ASCII)
    private val DIGEST = Regex("^[0-9a-f]{64}$")
    private val RECORD = Regex("^[0-9a-f]{64}[.](sealed|ack|review[.]sealed)$")
    private val RECORD_PENDING = Regex("^[0-9a-f]{64}[.]sealed$")
    private val TEMP = Regex("^[0-9a-f]{64}-[0-9a-f-]{36}[.]tmp$")
    private const val MAX_SEALED_BYTES = 4_096
    private const val ACK_RETENTION_MILLIS = 30L * 24 * 60 * 60_000

    fun forApplication(context: Context): ReceiverSmsEncryptedOutbox =
      ReceiverSmsEncryptedOutbox(
        // V1 entries have no sender provenance. Leave them sealed for review; never upload
        // them through a release that requires an exact provider sender.
        File(context.noBackupFilesDir, "receiver-sms-outbox-v2"),
        AndroidKeystoreLivePilotQueueCipher("fetanagent_receiver_sms_outbox_aes_v1"),
      )
  }
}
