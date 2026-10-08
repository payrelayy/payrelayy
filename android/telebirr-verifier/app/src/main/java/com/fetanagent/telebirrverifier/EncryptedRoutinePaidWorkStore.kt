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
import java.time.Instant
import java.util.UUID

/** Paid-phone work has a separate file and encryption domain from no-money rehearsals. */
internal sealed interface RoutinePaidPendingWork {
  val assignmentBytes: ByteArray

  class Assignment(override val assignmentBytes: ByteArray) : RoutinePaidPendingWork {
    override fun toString(): String = "RoutinePaidPendingWork.Assignment(<redacted>)"
  }

  class Upload(
    override val assignmentBytes: ByteArray,
    val uploadBytes: ByteArray,
  ) : RoutinePaidPendingWork {
    override fun toString(): String = "RoutinePaidPendingWork.Upload(<redacted>)"
  }
}

internal interface RoutinePaidWorkStore {
  fun load(): RoutinePaidPendingWork?
  fun stageAssignment(assignmentBytes: ByteArray)
  fun stageUpload(assignmentBytes: ByteArray, uploadBytes: ByteArray)
  fun acknowledge(uploadBytes: ByteArray)
  fun discardExpiredAssignment(nowMillis: Long)
}

/**
 * Atomic, Keystore-sealed outbox for one paid assignment. The phone must persist the signed
 * assignment before opening the public receipt, and the signed observation before any future
 * upload. A pending upload is retained even after assignment expiry for idempotent delivery.
 */
internal class EncryptedRoutinePaidWorkStore(
  directory: File,
  private val cipher: LivePilotQueueCipher,
) : RoutinePaidWorkStore {
  private val directory = directory.absoluteFile
  private val stateFile = File(this.directory, "routine-paid.sealed").absoluteFile

  init { prepareDirectory() }

  @Synchronized
  override fun load(): RoutinePaidPendingWork? = read()

  @Synchronized
  override fun stageAssignment(assignmentBytes: ByteArray) {
    requireAssignment(assignmentBytes)
    val existing = read()
    if (existing != null) {
      require(existing.assignmentBytes.contentEquals(assignmentBytes)) {
        "Another paid lookup is pending"
      }
      return
    }
    write(RoutinePaidPendingWork.Assignment(assignmentBytes.copyOf()))
  }

  @Synchronized
  override fun stageUpload(assignmentBytes: ByteArray, uploadBytes: ByteArray) {
    requireAssignment(assignmentBytes)
    requireUpload(assignmentBytes, uploadBytes)
    val existing = read()
    require(existing != null && existing.assignmentBytes.contentEquals(assignmentBytes)) {
      "No matching paid assignment is staged"
    }
    if (existing is RoutinePaidPendingWork.Upload) {
      require(existing.uploadBytes.contentEquals(uploadBytes)) {
        "A different paid observation is already staged"
      }
      return
    }
    write(RoutinePaidPendingWork.Upload(assignmentBytes.copyOf(), uploadBytes.copyOf()))
  }

  @Synchronized
  override fun acknowledge(uploadBytes: ByteArray) {
    val pending = read() as? RoutinePaidPendingWork.Upload
      ?: error("No signed paid upload is staged")
    require(pending.uploadBytes.contentEquals(uploadBytes))
    check(stateFile.delete()) { "Unable to remove acknowledged paid upload" }
  }

  @Synchronized
  override fun discardExpiredAssignment(nowMillis: Long) {
    val pending = read() as? RoutinePaidPendingWork.Assignment ?: return
    val assignment = requireAssignment(pending.assignmentBytes)
    if (nowMillis >= Instant.parse(assignment.body.expiresAt).toEpochMilli()) {
      check(stateFile.delete()) { "Unable to remove expired paid assignment" }
    }
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
    } ?: error("Unable to inspect paid work directory")
    inspectDirectory()
  }

  private fun inspectDirectory() {
    val files = directory.listFiles()?.toList() ?: error("Unable to inspect paid work directory")
    require(files.size <= 1)
    files.forEach { file ->
      require(file == stateFile && file.isFile && !Files.isSymbolicLink(file.toPath()))
      require(file.canonicalFile.parentFile == directory.canonicalFile)
    }
  }

  private fun read(): RoutinePaidPendingWork? {
    inspectDirectory()
    if (!stateFile.exists()) return null
    require(stateFile.length() in 1..MAX_SEALED_BYTES.toLong())
    val sealed = stateFile.inputStream().use { it.readBytes() }
    val plaintext = try { cipher.open(sealed, ASSOCIATED_DATA) } catch (failure: Exception) {
      sealed.fill(0)
      throw failure
    }
    try {
      require(plaintext.size in 1..MAX_PLAINTEXT_BYTES)
      DataInputStream(ByteArrayInputStream(plaintext)).use { input ->
        val magic = ByteArray(MAGIC.size).also(input::readFully)
        require(magic.contentEquals(MAGIC))
        val stateCode = input.readUnsignedByte()
        val assignment = readComponent(input, MAX_ASSIGNMENT_BYTES)
        val upload = readComponent(input, MAX_UPLOAD_BYTES)
        require(input.read() == -1)
        requireAssignment(assignment)
        return when (stateCode) {
          1 -> {
            require(upload.isEmpty())
            RoutinePaidPendingWork.Assignment(assignment)
          }
          2 -> {
            requireUpload(assignment, upload)
            RoutinePaidPendingWork.Upload(assignment, upload)
          }
          else -> error("Unknown paid work state")
        }
      }
    } finally {
      sealed.fill(0)
      plaintext.fill(0)
    }
  }

  private fun write(state: RoutinePaidPendingWork) {
    val assignment = state.assignmentBytes
    requireAssignment(assignment)
    val upload = if (state is RoutinePaidPendingWork.Upload) state.uploadBytes else ByteArray(0)
    if (state is RoutinePaidPendingWork.Upload) requireUpload(assignment, upload)
    val plaintext = ByteArrayOutputStream().use { bytes ->
      DataOutputStream(bytes).use { output ->
        output.write(MAGIC)
        output.writeByte(if (state is RoutinePaidPendingWork.Upload) 2 else 1)
        output.writeInt(assignment.size)
        output.write(assignment)
        output.writeInt(upload.size)
        output.write(upload)
      }
      bytes.toByteArray()
    }
    require(plaintext.size in 1..MAX_PLAINTEXT_BYTES)
    val sealed = try { cipher.seal(plaintext, ASSOCIATED_DATA) } catch (failure: Exception) {
      plaintext.fill(0)
      throw failure
    }
    require(sealed.size in 1..MAX_SEALED_BYTES)
    val temporary = File(directory, ".routine-paid-${UUID.randomUUID()}.tmp").absoluteFile
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
    }
  }

  private fun readComponent(input: DataInputStream, maximum: Int): ByteArray {
    val length = input.readInt()
    require(length in 0..maximum)
    return ByteArray(length).also(input::readFully)
  }

  private fun requireAssignment(bytes: ByteArray): RoutineSignedLookupAssignment {
    require(bytes.size in 1..MAX_ASSIGNMENT_BYTES)
    return requireNotNull(RoutineTelebirrJsonCodec.decodeSignedAssignment(bytes)) {
      "Invalid staged paid assignment"
    }
  }

  private fun requireUpload(assignment: ByteArray, upload: ByteArray) {
    require(upload.size in 1..MAX_UPLOAD_BYTES)
    val frame = StrictJson.parse(upload).requireObject(
      setOf("publicKeySpki", "signedAssignment", "signedObservation"))
    require(frame.string("publicKeySpki").isNotEmpty())
    require(StrictJson.encode(frame.value("signedAssignment")) ==
      assignment.toString(StandardCharsets.UTF_8))
    require(frame.value("signedObservation") is JsonValue.Object)
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

  override fun toString(): String = "EncryptedRoutinePaidWorkStore(<redacted>)"

  companion object {
    private val MAGIC = "FETAPW01".toByteArray(StandardCharsets.US_ASCII)
    private val TEMP_FILE = Regex("^\\.routine-paid-[0-9a-f-]{36}\\.tmp$")
    private val ASSOCIATED_DATA =
      "fetanagent:android:routine-paid-work:v1".toByteArray(StandardCharsets.US_ASCII)
    private const val MAX_ASSIGNMENT_BYTES = 16 * 1_024
    private const val MAX_UPLOAD_BYTES = 48 * 1_024
    private const val MAX_PLAINTEXT_BYTES = 8 + 1 + 4 + MAX_ASSIGNMENT_BYTES + 4 + MAX_UPLOAD_BYTES
    private const val MAX_SEALED_BYTES = MAX_PLAINTEXT_BYTES + 128

    fun forApplication(context: Context): EncryptedRoutinePaidWorkStore =
      EncryptedRoutinePaidWorkStore(
        File(context.applicationContext.noBackupFilesDir, "routine-paid-work-v1"),
        AndroidKeystoreLivePilotQueueCipher("fetanagent_telebirr_routine_paid_work_aes_v1"),
      )
  }
}
