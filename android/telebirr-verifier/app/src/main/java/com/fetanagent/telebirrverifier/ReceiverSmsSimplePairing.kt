package com.fetanagent.telebirrverifier

import android.content.Context
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.Base64

/** One code and one phone key. The server keeps the revocable authorization. */
internal class ReceiverSmsSimplePairing(private val context: Context) {
  private val preferences = context.getSharedPreferences("receiver_sms_pairing_v1", Context.MODE_PRIVATE)

  fun isPaired(identity: P256Identity): Boolean {
    val material = identity.publicMaterial()
    return preferences.getString("enrollment_id", null)?.matches(UUID) == true &&
      preferences.getString("key_digest", null) == material.publicKeySpkiSha256 &&
      preferences.getString("key_id", null) == material.keyId
  }

  fun deviceId(identity: P256Identity): String? =
    if (isPaired(identity)) deviceIdFor(identity) else null

  fun pair(code: String, identity: P256Identity): String {
    require(CODE.matches(code)) { "Enter the 12-character Owner code" }
    val material = identity.publicMaterial()
    val deviceId = deviceIdFor(identity)
    val transcript = listOf(DOMAIN, code, deviceId, material.keyId,
      material.publicKeySpkiBase64Url).joinToString("\n").toByteArray(StandardCharsets.UTF_8)
    val signature = Base64.getUrlEncoder().withoutPadding()
      .encodeToString(identity.signP1363(transcript))
    val request = StrictJson.encode(obj(
      "code" to text(code),
      "deviceId" to text(deviceId),
      "keyId" to text(material.keyId),
      "publicKeySpki" to text(material.publicKeySpkiBase64Url),
      "signature" to text(signature),
    )).toByteArray(StandardCharsets.UTF_8)
    require(request.size in 1..1_024)
    val url = URI("https", null, HOST, 443, PATH, null, null).toURL()
    require(url.protocol == "https" && url.host == HOST && url.path == PATH &&
      url.query == null && url.ref == null && url.userInfo == null)
    val connection = url.openConnection(Proxy.NO_PROXY) as javax.net.ssl.HttpsURLConnection
    val response = try {
      connection.instanceFollowRedirects = false
      connection.requestMethod = "POST"
      connection.connectTimeout = 5_000
      connection.readTimeout = 15_000
      connection.useCaches = false
      connection.doInput = true
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(request.size)
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Accept-Encoding", "identity")
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(request) }
      require(connection.responseCode == HttpURLConnection.HTTP_OK) {
        "The code could not pair this phone"
      }
      require(connection.contentType?.startsWith("application/json") == true)
      ByteArrayOutputStream().use { output ->
        connection.inputStream.use { input ->
          val buffer = ByteArray(512)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            require(output.size() + count <= 1_024)
            output.write(buffer, 0, count)
          }
        }
        output.toByteArray()
      }
    } finally {
      connection.disconnect()
    }
    val parsed = StrictJson.parse(response).requireObject(
      setOf("enrollmentId", "deviceId", "keyId", "alreadyEnrolled"))
    val enrollmentId = parsed.string("enrollmentId")
    parsed.boolean("alreadyEnrolled")
    require(UUID.matches(enrollmentId) && parsed.string("deviceId") == deviceId &&
      parsed.string("keyId") == material.keyId)
    require(preferences.edit()
      .putString("enrollment_id", enrollmentId)
      .putString("key_digest", material.publicKeySpkiSha256)
      .putString("key_id", material.keyId)
      .commit()) { "Phone pairing could not be saved" }
    return enrollmentId
  }

  companion object {
    private const val HOST = "owner.fetanagent.com"
    private const val PATH = "/v1/public/receiver-sms-phone:pair"
    private const val DOMAIN = "fetanagent:receiver-sms:phone-pairing:v1"
    private val CODE = Regex("^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$")
    private val UUID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

    fun deviceIdFor(identity: P256Identity): String =
      "routine_device_${identity.publicMaterial().publicKeySpkiSha256.removePrefix("sha256:")}"
  }
}
