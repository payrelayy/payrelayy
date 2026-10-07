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

/** One routine lookup at a time. Neither state is a payment claim or financial authority. */
internal sealed interface RoutineNoMoneyPendingWork {
  val assignmentBytes: ByteArray

  class Assignment(override val assignmentBytes: ByteArray) : RoutineNoMoneyPendingWork {
    override fun toString(): String = "RoutineNoMoneyPendingWork.Assignment(<redacted>)"
  }

  class Upload(
    override val assignmentBytes: ByteArray,
    val uploadBytes: ByteArray,
  ) : RoutineNoMoneyPendingWork {
    override fun toString(): String = "RoutineNoMoneyPendingWork.Upload(<redacted>)"
  }
}

internal interface RoutineNoMoneyWorkStore {
  fun load(): RoutineNoMoneyPendingWork?
  fun stageAssignment(assignmentBytes: ByteArray)
  fun stageUpload(assignmentBytes: ByteArray, uploadBytes: ByteArray)
  fun acknowledge(uploadBytes: ByteArray)
  fun discardExpired(nowMillis: Long)
}

/**
 * Keystore-sealed, atomic phone outbox for the one-use no-money poll. A signed assignment is
 * persisted before the official lookup; the exact signed upload is persisted before network I/O.
 * After a crash the caller resumes this record instead of consuming another poll request.
 */
internal class EncryptedRoutineNoMoneyWorkStore(
  directory: File,
  private val cipher: LivePilotQueueCipher,
) : RoutineNoMoneyWorkStore {
  private val directory = directory.absoluteFile
  private val stateFile = File(this.directory, "routine-no-money.sealed").absoluteFile

  init { prepareDirectory() }

  @Synchronized
  override fun load(): RoutineNoMoneyPendingWork? = read()

  @Synchronized
  override fun stageAssignment(assignmentBytes: ByteArray) {
    requireAssignment(assignmentBytes)
    val existing = read()
    if (existing != null) {
      require(existing.assignmentBytes.contentEquals(assignmentBytes)) {
        "Another routine lookup is pending"
      }
      return
    }
    write(RoutineNoMoneyPendingWork.Assignment(assignmentBytes.copyOf()))
  }

  @Synchronized
  override fun stageUpload(assignmentBytes: ByteArray, uploadBytes: ByteArray) {
    requireAssignment(assignmentBytes)
    requireUpload(assignmentBytes, uploadBytes)
    val existing = read()
    require(existing != null && existing.assignmentBytes.contentEquals(assignmentBytes)) {
      "No matching routine assignment is staged"
    }
    if (existing is RoutineNoMoneyPendingWork.Upload) {
      require(existing.uploadBytes.contentEquals(uploadBytes)) {
        "A different signed observation is already staged"
      }
      return
    }
    write(RoutineNoMoneyPendingWork.Upload(assignmentBytes.copyOf(), uploadBytes.copyOf()))
  }

  @Synchronized
  override fun acknowledge(uploadBytes: ByteArray) {
    val pending = read() as? RoutineNoMoneyPendingWork.Upload
      ?: error("No signed routine upload is staged")
    require(pending.uploadBytes.contentEquals(uploadBytes)) {
      "The acknowledged routine upload does not match the staged bytes"
    }
    check(stateFile.delete()) { "Unable to remove acknowledged routine upload" }
  }

  @Synchronized
  override fun discardExpired(nowMillis: Long) {
    val pending = read() ?: return
    val assignment = requireAssignment(pending.assignmentBytes)
    if (nowMillis >= Instant.parse(assignment.body.expiresAt).toEpochMilli()) {
      check(stateFile.delete()) { "Unable to remove expired routine lookup" }
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
    } ?: error("Unable to inspect routine work directory")
    inspectDirectory()
  }

  private fun inspectDirectory() {
    val files = directory.listFiles()?.toList() ?: error("Unable to inspect routine work directory")
    require(files.size <= 1)
    files.forEach { file ->
      require(file == stateFile && file.isFile && !Files.isSymbolicLink(file.toPath()))
      require(file.canonicalFile.parentFile == directory.canonicalFile)
    }
  }

  private fun read(): RoutineNoMoneyPendingWork? {
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
            RoutineNoMoneyPendingWork.Assignment(assignment)
          }
          2 -> {
            requireUpload(assignment, upload)
            RoutineNoMoneyPendingWork.Upload(assignment, upload)
          }
          else -> error("Unknown routine work state")
        }
      }
    } finally {
      sealed.fill(0)
      plaintext.fill(0)
    }
  }

  private fun write(state: RoutineNoMoneyPendingWork) {
    val assignment = state.assignmentBytes
    requireAssignment(assignment)
    val upload = if (state is RoutineNoMoneyPendingWork.Upload) state.uploadBytes else ByteArray(0)
    if (state is RoutineNoMoneyPendingWork.Upload) requireUpload(assignment, upload)
    val plaintext = ByteArrayOutputStream().use { bytes ->
      DataOutputStream(bytes).use { output ->
        output.write(MAGIC)
        output.writeByte(if (state is RoutineNoMoneyPendingWork.Upload) 2 else 1)
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
    val temporary = File(directory, ".routine-no-money-${UUID.randomUUID()}.tmp").absoluteFile
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
      "Invalid staged routine assignment"
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

  override fun toString(): String = "EncryptedRoutineNoMoneyWorkStore(<redacted>)"

  companion object {
    private val MAGIC = "FETARW01".toByteArray(StandardCharsets.US_ASCII)
    private val TEMP_FILE = Regex("^\\.routine-no-money-[0-9a-f-]{36}\\.tmp$")
    private val ASSOCIATED_DATA =
      "fetanagent:android:routine-no-money-work:v1".toByteArray(StandardCharsets.US_ASCII)
    private const val MAX_ASSIGNMENT_BYTES = 16 * 1_024
    private const val MAX_UPLOAD_BYTES = 48 * 1_024
    private const val MAX_PLAINTEXT_BYTES = 8 + 1 + 4 + MAX_ASSIGNMENT_BYTES + 4 + MAX_UPLOAD_BYTES
    private const val MAX_SEALED_BYTES = MAX_PLAINTEXT_BYTES + 128

    fun forApplication(context: Context): EncryptedRoutineNoMoneyWorkStore =
      EncryptedRoutineNoMoneyWorkStore(
        File(context.applicationContext.noBackupFilesDir, "routine-no-money-work-v1"),
        AndroidKeystoreLivePilotQueueCipher("fetanagent_telebirr_routine_no_money_work_aes_v1"),
      )
  }
}
