package com.fetanagent.telebirrverifier

import java.io.IOException
import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FixedDeviceBridgeHttpsExchangeTest {
  @Test
  fun `posts only to the immutable origin with bounded transport settings`() {
    var captured: CapturedRequest? = null
    val exchange =
      FixedDeviceBridgeHttpsExchange { url, contentType, body, connect, read, maximum ->
        captured = CapturedRequest(url, contentType, body.copyOf(), connect, read, maximum)
        exactResponse()
      }

    val response =
      exchange.post(
        DeviceBridgeProtocol.ASSIGNMENT_POLL_PATH,
        DeviceBridgeProtocol.CONTENT_TYPE,
        byteArrayOf(1, 2, 3),
      )

    val request = requireNotNull(captured)
    assertEquals("https", request.url.protocol)
    assertEquals(FixedDeviceBridgeHttpsExchange.ORIGIN_HOST, request.url.host)
    assertEquals(443, request.url.port)
    assertEquals(DeviceBridgeProtocol.ASSIGNMENT_POLL_PATH, request.url.path)
    assertEquals(null, request.url.query)
    assertEquals(null, request.url.userInfo)
    assertEquals(DeviceBridgeProtocol.CONTENT_TYPE, request.contentType)
    assertTrue(request.body.contentEquals(byteArrayOf(1, 2, 3)))
    assertEquals(FixedDeviceBridgeHttpsExchange.CONNECT_TIMEOUT_MILLIS, request.connectTimeout)
    assertEquals(FixedDeviceBridgeHttpsExchange.READ_TIMEOUT_MILLIS, request.readTimeout)
    assertEquals(FixedDeviceBridgeHttpsExchange.MAX_RESPONSE_BYTES, request.maximumResponseBytes)
    assertEquals(200, response.statusCode)
    assertTrue(response.body.contentEquals("{}".toByteArray()))
  }

  @Test
  fun `permits exactly the four protocol paths`() {
    val observed = mutableListOf<String>()
    val exchange =
      FixedDeviceBridgeHttpsExchange { url, _, _, _, _, _ ->
        observed += url.path
        exactResponse()
      }
    val paths =
      listOf(
        DeviceBridgeProtocol.PAIRING_PATH,
        DeviceBridgeProtocol.ASSIGNMENT_POLL_PATH,
        DeviceBridgeProtocol.HEARTBEAT_PATH,
        DeviceBridgeProtocol.OBSERVATION_UPLOAD_PATH,
      )
    paths.forEach { path ->
      exchange.post(path, DeviceBridgeProtocol.CONTENT_TYPE, byteArrayOf(1))
    }
    assertEquals(paths, observed)
    assertThrows(IllegalArgumentException::class.java) {
      exchange.post("/v1/other", DeviceBridgeProtocol.CONTENT_TYPE, byteArrayOf(1))
    }
  }

  @Test
  fun `rejects invalid request metadata before transport`() {
    var called = false
    val exchange =
      FixedDeviceBridgeHttpsExchange { _, _, _, _, _, _ ->
        called = true
        exactResponse()
      }
    assertThrows(IllegalArgumentException::class.java) {
      exchange.post(DeviceBridgeProtocol.HEARTBEAT_PATH, "application/json", byteArrayOf(1))
    }
    assertThrows(IllegalArgumentException::class.java) {
      exchange.post(
        DeviceBridgeProtocol.HEARTBEAT_PATH,
        DeviceBridgeProtocol.CONTENT_TYPE,
        byteArrayOf(),
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      exchange.post(
        DeviceBridgeProtocol.HEARTBEAT_PATH,
        DeviceBridgeProtocol.CONTENT_TYPE,
        ByteArray(FixedDeviceBridgeHttpsExchange.MAX_REQUEST_BYTES + 1),
      )
    }
    assertFalse(called)
  }

  @Test
  fun `rejects redirects duplicate or wrong security headers and oversized bodies`() {
    val invalidResponses =
      listOf(
        DeviceBridgeHttpsResponse(
          99,
          listOf(DeviceBridgeProtocol.CONTENT_TYPE),
          emptyList(),
          byteArrayOf(),
        ),
        DeviceBridgeHttpsResponse(
          302,
          listOf(DeviceBridgeProtocol.CONTENT_TYPE),
          emptyList(),
          byteArrayOf(),
        ),
        DeviceBridgeHttpsResponse(200, emptyList(), emptyList(), byteArrayOf()),
        DeviceBridgeHttpsResponse(
          200,
          listOf(DeviceBridgeProtocol.CONTENT_TYPE, DeviceBridgeProtocol.CONTENT_TYPE),
          emptyList(),
          byteArrayOf(),
        ),
        DeviceBridgeHttpsResponse(200, listOf("application/json"), emptyList(), byteArrayOf()),
        DeviceBridgeHttpsResponse(
          200,
          listOf(DeviceBridgeProtocol.CONTENT_TYPE),
          listOf("gzip"),
          byteArrayOf(),
        ),
        DeviceBridgeHttpsResponse(
          200,
          listOf(DeviceBridgeProtocol.CONTENT_TYPE),
          listOf("identity", "identity"),
          byteArrayOf(),
        ),
        DeviceBridgeHttpsResponse(
          200,
          listOf(DeviceBridgeProtocol.CONTENT_TYPE),
          emptyList(),
          ByteArray(FixedDeviceBridgeHttpsExchange.MAX_RESPONSE_BYTES + 1),
        ),
      )
    invalidResponses.forEach { response ->
      val exchange = FixedDeviceBridgeHttpsExchange { _, _, _, _, _, _ -> response }
      assertThrows(DeviceBridgeRetryableException::class.java) {
        exchange.post(
          DeviceBridgeProtocol.HEARTBEAT_PATH,
          DeviceBridgeProtocol.CONTENT_TYPE,
          byteArrayOf(1),
        )
      }
    }
  }

  @Test
  fun `maps transport failures to retryable and keeps diagnostics redacted`() {
    val exchange =
      FixedDeviceBridgeHttpsExchange { _, _, _, _, _, _ -> throw IOException("secret response") }
    val failure =
      assertThrows(DeviceBridgeRetryableException::class.java) {
        exchange.post(
          DeviceBridgeProtocol.HEARTBEAT_PATH,
          DeviceBridgeProtocol.CONTENT_TYPE,
          byteArrayOf(1),
        )
      }
    assertFalse(failure.toString().contains("secret response"))
    assertFalse(
      DeviceBridgeHttpsResponse(200, listOf("secret"), listOf("secret"), "secret".toByteArray())
        .toString()
        .contains("secret"),
    )

    val denied =
      FixedDeviceBridgeHttpsExchange { _, _, _, _, _, _ ->
        throw SecurityException("secret policy")
      }
    assertThrows(DeviceBridgeRetryableException::class.java) {
      denied.post(
        DeviceBridgeProtocol.HEARTBEAT_PATH,
        DeviceBridgeProtocol.CONTENT_TYPE,
        byteArrayOf(1),
      )
    }
  }

  private fun exactResponse(): DeviceBridgeHttpsResponse =
    DeviceBridgeHttpsResponse(
      statusCode = 200,
      contentTypes = listOf(DeviceBridgeProtocol.CONTENT_TYPE),
      contentEncodings = emptyList(),
      body = "{}".toByteArray(),
    )

  private data class CapturedRequest(
    val url: URL,
    val contentType: String,
    val body: ByteArray,
    val connectTimeout: Int,
    val readTimeout: Int,
    val maximumResponseBytes: Int,
  )
}
