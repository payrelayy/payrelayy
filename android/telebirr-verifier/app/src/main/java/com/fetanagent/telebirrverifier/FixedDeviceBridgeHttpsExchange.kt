package com.fetanagent.telebirrverifier

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URI
import java.net.URL
import javax.net.ssl.HttpsURLConnection

internal data class DeviceBridgeHttpsResponse(
  val statusCode: Int,
  val contentTypes: List<String>,
  val contentEncodings: List<String>,
  val body: ByteArray,
) {
  override fun toString(): String =
    "DeviceBridgeHttpsResponse(statusCode=$statusCode,headers=<redacted>,body=<redacted>)"
}

internal fun interface DeviceBridgeHttpsExecutor {
  fun execute(
    url: URL,
    contentType: String,
    body: ByteArray,
    connectTimeoutMillis: Int,
    readTimeoutMillis: Int,
    maximumResponseBytes: Int,
  ): DeviceBridgeHttpsResponse
}

/**
 * Immutable HTTPS transport for the FetanAgent device bridge. The hostname and four paths are
 * code-owned; redirects, platform proxies, compression, duplicate security headers, query strings,
 * user info, and oversized bodies are rejected. Signed protocol messages remain the application
 * authentication boundary above TLS.
 */
class FixedDeviceBridgeHttpsExchange internal constructor(
  private val executor: DeviceBridgeHttpsExecutor = PlatformDeviceBridgeHttpsExecutor,
) : DeviceBridgeExchange {
  override fun post(path: String, contentType: String, body: ByteArray): DeviceBridgeRawResponse {
    require(path in allowedPaths) { "Unsupported device bridge path" }
    require(contentType == DeviceBridgeProtocol.CONTENT_TYPE) { "Unsupported content type" }
    require(body.isNotEmpty() && body.size <= MAX_REQUEST_BYTES) { "Invalid request size" }

    val url = URI("https", null, ORIGIN_HOST, HTTPS_PORT, path, null, null).toURL()
    require(
      url.protocol == "https" &&
        url.host == ORIGIN_HOST &&
        url.port == HTTPS_PORT &&
        url.userInfo == null &&
        url.query == null &&
        url.ref == null &&
        url.path == path,
    )

    val response =
      try {
        executor.execute(
          url,
          contentType,
          body,
          CONNECT_TIMEOUT_MILLIS,
          READ_TIMEOUT_MILLIS,
          MAX_RESPONSE_BYTES,
        )
      } catch (_: IOException) {
        throw DeviceBridgeRetryableException()
      } catch (_: SecurityException) {
        throw DeviceBridgeRetryableException()
      }

    if (response.statusCode !in 100..599 || response.statusCode in 300..399) {
      throw DeviceBridgeRetryableException()
    }
    if (
      response.contentTypes.size != 1 ||
        response.contentTypes.single() != DeviceBridgeProtocol.CONTENT_TYPE ||
        response.contentEncodings.any { !it.equals("identity", ignoreCase = true) } ||
        response.contentEncodings.size > 1 ||
        response.body.size > MAX_RESPONSE_BYTES
    ) {
      throw DeviceBridgeRetryableException()
    }
    return DeviceBridgeRawResponse(
      statusCode = response.statusCode,
      contentType = response.contentTypes.single(),
      body = response.body.copyOf(),
    )
  }

  override fun toString(): String = "FixedDeviceBridgeHttpsExchange(origin=$ORIGIN_HOST)"

  companion object {
    const val ORIGIN_HOST = "device.fetanagent.com"
    const val CONNECT_TIMEOUT_MILLIS = 5_000
    const val READ_TIMEOUT_MILLIS = 15_000
    const val MAX_REQUEST_BYTES = 256 * 1_024
    const val MAX_RESPONSE_BYTES = 256 * 1_024
    private const val HTTPS_PORT = 443
    private val allowedPaths =
      setOf(
        DeviceBridgeProtocol.PAIRING_PATH,
        DeviceBridgeProtocol.ASSIGNMENT_POLL_PATH,
        DeviceBridgeProtocol.HEARTBEAT_PATH,
        DeviceBridgeProtocol.OBSERVATION_UPLOAD_PATH,
      )
  }
}

internal object PlatformDeviceBridgeHttpsExecutor : DeviceBridgeHttpsExecutor {
  override fun execute(
    url: URL,
    contentType: String,
    body: ByteArray,
    connectTimeoutMillis: Int,
    readTimeoutMillis: Int,
    maximumResponseBytes: Int,
  ): DeviceBridgeHttpsResponse {
    require(url.protocol == "https")
    require(url.host == FixedDeviceBridgeHttpsExchange.ORIGIN_HOST)
    require(url.port == 443)
    require(url.userInfo == null && url.query == null && url.ref == null)
    require(contentType == DeviceBridgeProtocol.CONTENT_TYPE)
    require(body.isNotEmpty() && body.size <= FixedDeviceBridgeHttpsExchange.MAX_REQUEST_BYTES)

    val connection =
      url.openConnection(Proxy.NO_PROXY) as? HttpsURLConnection
        ?: throw IOException("HTTPS transport unavailable")
    try {
      connection.instanceFollowRedirects = false
      connection.requestMethod = "POST"
      connection.connectTimeout = connectTimeoutMillis
      connection.readTimeout = readTimeoutMillis
      connection.useCaches = false
      connection.doInput = true
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(body.size)
      connection.setRequestProperty("Accept", DeviceBridgeProtocol.CONTENT_TYPE)
      connection.setRequestProperty("Accept-Encoding", "identity")
      connection.setRequestProperty("Content-Type", contentType)
      connection.setRequestProperty("User-Agent", "FetanAgent-TeleBirr-Verifier/1")
      connection.outputStream.use { output ->
        output.write(body)
        output.flush()
      }

      val statusCode = connection.responseCode
      val declaredLength = connection.contentLengthLong
      if (declaredLength > maximumResponseBytes) {
        throw IOException("Device bridge response exceeds the bound")
      }
      val responseBody =
        (if (statusCode >= HttpURLConnection.HTTP_BAD_REQUEST) {
            connection.errorStream
          } else {
            connection.inputStream
          })
          ?.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(4_096)
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              if (output.size() + read > maximumResponseBytes) {
                throw IOException("Device bridge response exceeds the bound")
              }
              output.write(buffer, 0, read)
            }
            output.toByteArray()
          }
          ?: ByteArray(0)
      return DeviceBridgeHttpsResponse(
        statusCode = statusCode,
        contentTypes = headerValues(connection, "Content-Type"),
        contentEncodings = headerValues(connection, "Content-Encoding"),
        body = responseBody,
      )
    } finally {
      connection.disconnect()
    }
  }

  private fun headerValues(connection: HttpsURLConnection, name: String): List<String> =
    connection.headerFields.entries
      .filter { (key, _) -> key?.equals(name, ignoreCase = true) == true }
      .flatMap { (_, values) -> values.orEmpty() }
      .map(String::trim)
}
