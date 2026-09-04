package com.fetanagent.telebirrverifier

import android.content.Context
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
import java.util.UUID

sealed interface DeviceProvisioningState {
  data class Pending(
    val grant: DevicePairingGrant,
    val signedPairingRequest: SignedDeviceBridgePairingRequest,
  ) : DeviceProvisioningState {
    init {
      require(DeviceBridgeVerifier.verifyPairing(signedPairingRequest))
      require(signedPairingRequest.body.pairingId == grant.pairingId)
      require(signedPairingRequest.body.pairingNonceDigest == grant.pairingNonceDigest)
      require(signedPairingRequest.body.expiresAt <= grant.expiresAt)
    }

    override fun toString(): String = "DeviceProvisioningState.Pending(<redacted>)"
  }

  data class Enrolled(
    val certificate: SignedDeviceBridgeEnrollmentCertificate,
  ) : DeviceProvisioningState {
    override fun toString(): String = "DeviceProvisioningState.Enrolled(<redacted>)"
  }
}

interface DeviceProvisioningStore {
  fun load(): DeviceProvisioningState?

  fun stagePending(state: DeviceProvisioningState.Pending)

  fun complete(certificate: SignedDeviceBridgeEnrollmentCertificate)
}

/**
 * One crash-safe encrypted record for the one-use grant, exact retry request, or signed enrollment
 * certificate. It is kept below no-backup storage and sealed with a provisioning-specific Android
 * Keystore key, independent of the evidence queue key.
 */
class EncryptedFileDeviceProvisioningStore(
  directory: File,
  private val cipher: LivePilotQueueCipher,
) : DeviceProvisioningStore {
  private val directory = directory.absoluteFile
  private val stateFile = File(this.directory, STATE_FILE_NAME).absoluteFile

  init {
    prepareDirectory()
  }

  @Synchronized
  override fun load(): DeviceProvisioningState? {
    inspectDirectory()
    if (!stateFile.exists()) return null
    require(stateFile.isFile && !Files.isSymbolicLink(stateFile.toPath()))
    require(stateFile.canonicalFile.parentFile == directory.canonicalFile)
    require(stateFile.length() in 1..MAX_SEALED_BYTES.toLong())
    val sealed = stateFile.inputStream().use { input -> input.readBytes() }
    val plaintext = cipher.open(sealed, ASSOCIATED_DATA)
    return try {
      decode(plaintext)
    } finally {
      sealed.fill(0)
      plaintext.fill(0)
    }
  }

  @Synchronized
  override fun stagePending(state: DeviceProvisioningState.Pending) {
    val existing = load()
    if (existing is DeviceProvisioningState.Enrolled) {
      val enrolled = existing.certificate.body
      val replacement = state.signedPairingRequest.body
      require(replacement.deviceId == enrolled.deviceId)
      require(replacement.keyId == enrolled.keyId)
      require(replacement.devicePublicKeySpki == enrolled.devicePublicKeySpki)
      require(replacement.devicePublicKeySpkiSha256 == enrolled.devicePublicKeySpkiSha256)
      require(enrolled.validUntil <= replacement.issuedAt)
    }
    if (existing is DeviceProvisioningState.Pending && existing == state) return
    write(state)
  }

  @Synchronized
  override fun complete(certificate: SignedDeviceBridgeEnrollmentCertificate) {
    val pending = load() as? DeviceProvisioningState.Pending
      ?: error("No pending pairing request")
    require(DeviceBridgeVerifier.certificateMatchesPairing(certificate, pending.signedPairingRequest))
    write(DeviceProvisioningState.Enrolled(certificate))
  }

  private fun prepareDirectory() {
    val parent = requireNotNull(directory.parentFile).absoluteFile
    require(parent.exists() && parent.isDirectory && !Files.isSymbolicLink(parent.toPath()))
    if (!directory.exists()) check(directory.mkdir()) { "Unable to create provisioning directory" }
    require(directory.isDirectory && !Files.isSymbolicLink(directory.toPath()))
    require(directory.canonicalFile.parentFile == parent.canonicalFile)
    restrictOwnerAccess(directory, executable = true)
    directory.listFiles()?.forEach { file ->
      if (TEMP_FILE_PATTERN.matches(file.name)) {
        require(file.isFile && !Files.isSymbolicLink(file.toPath()))
        check(file.delete()) { "Unable to remove interrupted provisioning write" }
      }
    } ?: error("Unable to inspect provisioning directory")
    inspectDirectory()
  }

  private fun inspectDirectory() {
    val files = directory.listFiles()?.toList() ?: error("Unable to inspect provisioning directory")
    require(files.size <= 1)
    files.forEach { file ->
      require(file.name == STATE_FILE_NAME)
      require(file.isFile && !Files.isSymbolicLink(file.toPath()))
      require(file.canonicalFile.parentFile == directory.canonicalFile)
    }
  }

  private fun write(state: DeviceProvisioningState) {
    val plaintext = encode(state)
    val sealed = cipher.seal(plaintext, ASSOCIATED_DATA)
    require(sealed.size in 1..MAX_SEALED_BYTES)
    val temporary = File(directory, ".provisioning-${UUID.randomUUID()}.tmp").absoluteFile
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
          stateFile.toPath(),
          StandardCopyOption.ATOMIC_MOVE,
          StandardCopyOption.REPLACE_EXISTING,
        )
      } catch (failure: AtomicMoveNotSupportedException) {
        throw IllegalStateException("Provisioning state requires atomic replacement", failure)
      }
      require(stateFile.isFile && !Files.isSymbolicLink(stateFile.toPath()))
      restrictOwnerAccess(stateFile, executable = false)
    } finally {
      if (temporary.exists()) temporary.delete()
      plaintext.fill(0)
      sealed.fill(0)
    }
  }

  private fun encode(state: DeviceProvisioningState): ByteArray {
    val first: ByteArray
    val second: ByteArray
    val code: Int
    when (state) {
      is DeviceProvisioningState.Pending -> {
        code = PENDING_CODE
        first =
          DeviceBridgeJsonCodec.encodePairingGrantPackage(state.grant)
            .toByteArray(StandardCharsets.US_ASCII)
        second = DeviceBridgeJsonCodec.encodePairingRequest(state.signedPairingRequest)
      }
      is DeviceProvisioningState.Enrolled -> {
        code = ENROLLED_CODE
        first = DeviceBridgeJsonCodec.encodeEnrollmentCertificate(state.certificate)
        second = ByteArray(0)
      }
    }
    require(first.size in 1..MAX_COMPONENT_BYTES)
    require(second.size in 0..MAX_COMPONENT_BYTES)
    return ByteArrayOutputStream(RECORD_MAGIC.size + 1 + 8 + first.size + second.size).use {
      DataOutputStream(it).use { output ->
        output.write(RECORD_MAGIC)
        output.writeByte(code)
        output.writeInt(first.size)
        output.write(first)
        output.writeInt(second.size)
        output.write(second)
      }
      it.toByteArray()
    }
  }

  private fun decode(bytes: ByteArray): DeviceProvisioningState {
    require(bytes.size in MIN_PLAINTEXT_BYTES..MAX_PLAINTEXT_BYTES)
    val input = DataInputStream(ByteArrayInputStream(bytes))
    val magic = ByteArray(RECORD_MAGIC.size).also(input::readFully)
    require(magic.contentEquals(RECORD_MAGIC))
    val code = input.readUnsignedByte()
    val firstLength = input.readInt()
    require(firstLength in 1..MAX_COMPONENT_BYTES)
    val first = ByteArray(firstLength).also(input::readFully)
    val secondLength = input.readInt()
    require(secondLength in 0..MAX_COMPONENT_BYTES)
    val second = ByteArray(secondLength).also(input::readFully)
    require(input.read() == -1)
    return when (code) {
      PENDING_CODE -> {
        require(second.isNotEmpty())
        val packageValue = first.toString(StandardCharsets.US_ASCII)
        DeviceProvisioningState.Pending(
          grant = requireNotNull(DeviceBridgeJsonCodec.decodePairingGrantPackage(packageValue)),
          signedPairingRequest = requireNotNull(DeviceBridgeJsonCodec.decodePairingRequest(second)),
        )
      }
      ENROLLED_CODE -> {
        require(second.isEmpty())
        DeviceProvisioningState.Enrolled(
          requireNotNull(DeviceBridgeJsonCodec.decodeEnrollmentCertificate(first)),
        )
      }
      else -> error("Unknown provisioning state")
    }
  }

  private fun restrictOwnerAccess(file: File, executable: Boolean) {
    if (System.getProperty("os.name").orEmpty().startsWith("Windows", ignoreCase = true)) return
    check(file.setReadable(false, false)) { "Unable to clear provisioning read access" }
    check(file.setWritable(false, false)) { "Unable to clear provisioning write access" }
    check(file.setExecutable(false, false)) { "Unable to clear provisioning execute access" }
    check(file.setReadable(true, true)) { "Unable to restrict provisioning read access" }
    check(file.setWritable(true, true)) { "Unable to restrict provisioning write access" }
    if (executable) {
      check(file.setExecutable(true, true)) { "Unable to restrict provisioning execute access" }
    }
  }

  override fun toString(): String = "EncryptedFileDeviceProvisioningStore(<redacted>)"

  companion object {
    private const val STATE_FILE_NAME = "provisioning.sealed"
    private const val PENDING_CODE = 1
    private const val ENROLLED_CODE = 2
    private const val MAX_COMPONENT_BYTES = 64 * 1_024
    private const val MAX_PLAINTEXT_BYTES = MAX_COMPONENT_BYTES * 2 + 64
    private const val MIN_PLAINTEXT_BYTES = 8 + 1 + 4 + 1 + 4
    private const val MAX_SEALED_BYTES = MAX_PLAINTEXT_BYTES + 128
    private const val PROVISIONING_KEY_ALIAS =
      "fetanagent_telebirr_device_provisioning_aes_v1"
    private val RECORD_MAGIC = "FETAPR01".toByteArray(StandardCharsets.US_ASCII)
    private val TEMP_FILE_PATTERN = Regex("^\\.provisioning-[0-9a-f-]{36}\\.tmp$")
    private val ASSOCIATED_DATA =
      "fetanagent:android:device-provisioning:v1".toByteArray(StandardCharsets.US_ASCII)

    fun forApplication(context: Context): EncryptedFileDeviceProvisioningStore =
      EncryptedFileDeviceProvisioningStore(
        directory =
          File(context.applicationContext.noBackupFilesDir, "telebirr-device-provisioning-v1"),
        cipher = AndroidKeystoreLivePilotQueueCipher(PROVISIONING_KEY_ALIAS),
      )
  }
}
