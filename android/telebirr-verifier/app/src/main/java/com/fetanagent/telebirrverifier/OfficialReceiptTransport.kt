package com.fetanagent.telebirrverifier

import java.io.ByteArrayOutputStream
import java.io.BufferedInputStream
import java.io.EOFException
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.format.DateTimeFormatterBuilder
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

class OfficialReceiptRoute private constructor(private val uri: URI) {
  val host: String
    get() = uri.host

  internal fun <T> useUrl(block: (URL) -> T): T = block(uri.toURL())

  override fun toString(): String = "OfficialReceiptRoute(host=$host,path=<redacted>)"

  companion object {
    const val OFFICIAL_HOST = "transactioninfo.ethiotelecom.et"
    private const val FIXED_PATH_PREFIX = "/receipt/"

    fun forReference(reference: CanonicalReference): OfficialReceiptRoute =
      reference.use { canonical ->
        RelayProtocol.requireCanonicalReference(canonical)
        val uri = URI("https", OFFICIAL_HOST, "$FIXED_PATH_PREFIX$canonical", null)
        require(uri.scheme == "https" && uri.host == OFFICIAL_HOST)
        require(uri.rawQuery == null && uri.rawFragment == null && uri.userInfo == null)
        OfficialReceiptRoute(uri)
      }
  }
}

sealed interface ProviderDocument {
  data class Found(
    val utf8Body: String,
    val sourceDocumentDigest: String,
    val retrievedAt: String,
  ) : ProviderDocument {
    override fun toString(): String =
      "ProviderDocument.Found(body=<redacted>,sourceDocumentDigest=<redacted>,retrievedAt=$retrievedAt)"
  }

  data class NotFound(val sourceDocumentDigest: String) : ProviderDocument {
    override fun toString(): String = "ProviderDocument.NotFound(sourceDocumentDigest=<redacted>)"
  }

  data class Unavailable(val uncertainty: String, val sourceDocumentDigest: String) : ProviderDocument {
    init {
      require(uncertainty in setOf("provider", "network", "parser", "device"))
    }

    override fun toString(): String =
      "ProviderDocument.Unavailable(uncertainty=$uncertainty,sourceDocumentDigest=<redacted>)"
  }
}

fun interface ProviderTransport {
  fun retrieve(route: OfficialReceiptRoute): ProviderDocument
}

fun interface HostResolver {
  fun resolve(host: String, timeoutMillis: Int): List<InetAddress>
}

fun interface HttpsExchange {
  fun execute(
    url: URL,
    resolvedAddresses: List<InetAddress>,
    timeoutMillis: Int,
    maximumBytes: Int,
  ): RawHttpsResponse
}

fun interface MillisClock {
  fun nowMillis(): Long
}

data class RawHttpsResponse(
  val statusCode: Int,
  val contentType: String?,
  val contentEncoding: String?,
  val body: ByteArray,
) {
  override fun toString(): String =
    "RawHttpsResponse(statusCode=$statusCode,contentType=$contentType,contentEncoding=$contentEncoding,body=<redacted>)"
}

class SafeOfficialReceiptTransport(
  private val resolver: HostResolver = BoundedSystemHostResolver,
  private val exchange: HttpsExchange = PlatformHttpsExchange,
  private val clock: MillisClock = MillisClock(System::currentTimeMillis),
) : ProviderTransport {
  override fun retrieve(route: OfficialReceiptRoute): ProviderDocument {
    val startedAt = clock.nowMillis()
    val deadline = startedAt + TOTAL_TIMEOUT_MILLIS
    return try {
      require(route.host == OfficialReceiptRoute.OFFICIAL_HOST)
      val addresses = resolver.resolve(route.host, remaining(deadline))
      if (addresses.isEmpty() || addresses.any { !PublicInternetAddressPolicy.isPublic(it) }) {
        return unavailable("network")
      }
      val response =
        route.useUrl { url ->
          exchange.execute(url, addresses.toList(), remaining(deadline), MAX_RESPONSE_BYTES)
        }
      if (clock.nowMillis() > deadline) return unavailable("network")
      when {
        response.statusCode in 300..399 -> unavailable("provider")
        // A bare status code is not an attested provider negative-response contract. Treat every
        // 404 as uncertainty until a separately reviewed response profile can prove `not_found`.
        response.statusCode == HttpURLConnection.HTTP_NOT_FOUND -> unavailable("provider")
        response.statusCode != HttpURLConnection.HTTP_OK -> unavailable("provider")
        response.body.size > MAX_RESPONSE_BYTES -> unavailable("provider")
        !isIdentityEncoding(response.contentEncoding) -> unavailable("provider")
        !isStrictUtf8Html(response.contentType) -> unavailable("provider")
        else -> {
          val decoded = decodeUtf8Strict(response.body) ?: return unavailable("parser")
          ProviderDocument.Found(
            utf8Body = decoded,
            sourceDocumentDigest = CanonicalTranscripts.sha256(response.body),
            retrievedAt = canonicalTimestamp(clock.nowMillis()),
          )
        }
      }
    } catch (_: TimeoutException) {
      unavailable("network")
    } catch (_: IOException) {
      unavailable("network")
    } catch (_: SecurityException) {
      unavailable("network")
    } catch (_: IllegalArgumentException) {
      unavailable("provider")
    }
  }

  private fun remaining(deadline: Long): Int {
    val remaining = deadline - clock.nowMillis()
    if (remaining <= 0L) throw TimeoutException("Provider lookup deadline elapsed")
    return remaining.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
  }

  private fun unavailable(uncertainty: String): ProviderDocument.Unavailable =
    ProviderDocument.Unavailable(
      uncertainty = uncertainty,
      sourceDocumentDigest = CanonicalTranscripts.sha256("telebirr-unavailable-$uncertainty-v1".toByteArray()),
    )

  companion object {
    const val TOTAL_TIMEOUT_MILLIS = 5_000
    const val MAX_RESPONSE_BYTES = 32 * 1024
    private val timestampFormatter = DateTimeFormatterBuilder().appendInstant(3).toFormatter()

    internal fun canonicalTimestamp(epochMillis: Long): String =
      timestampFormatter.format(Instant.ofEpochMilli(epochMillis))

    internal fun isStrictUtf8Html(contentType: String?): Boolean {
      if (contentType == null) return false
      val pieces = contentType.split(';').map(String::trim)
      if (!pieces.first().equals("text/html", ignoreCase = true)) return false
      if (pieces.size == 1) return true
      if (pieces.size != 2) return false
      val parameter = pieces[1].split('=', limit = 2)
      if (parameter.size != 2 || !parameter[0].trim().equals("charset", ignoreCase = true)) return false
      return parameter[1].trim().trim('"').equals("utf-8", ignoreCase = true)
    }

    private fun isIdentityEncoding(contentEncoding: String?): Boolean =
      contentEncoding == null || contentEncoding.equals("identity", ignoreCase = true)

    private fun decodeUtf8Strict(bytes: ByteArray): String? =
      runCatching {
          StandardCharsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
        }
        .getOrNull()
  }
}

object BoundedSystemHostResolver : HostResolver {
  override fun resolve(host: String, timeoutMillis: Int): List<InetAddress> {
    val executor = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "telebirr-dns").apply { isDaemon = true }
    }
    return try {
      executor
        .submit(Callable { InetAddress.getAllByName(host).toList() })
        .get(timeoutMillis.toLong(), TimeUnit.MILLISECONDS)
    } finally {
      executor.shutdownNow()
    }
  }
}

object PlatformHttpsExchange : HttpsExchange {
  override fun execute(
    url: URL,
    resolvedAddresses: List<InetAddress>,
    timeoutMillis: Int,
    maximumBytes: Int,
  ): RawHttpsResponse {
    require(url.protocol == "https")
    require(url.host == OfficialReceiptRoute.OFFICIAL_HOST)
    require(url.port == -1 || url.port == HTTPS_PORT)
    require(url.query == null && url.ref == null && url.userInfo == null)
    require(Regex("^/receipt/[A-Z0-9]{8,64}$").matches(url.path))
    require(resolvedAddresses.isNotEmpty() && resolvedAddresses.all(PublicInternetAddressPolicy::isPublic))
    val deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis.toLong())
    var lastFailure: IOException? = null
    for (address in resolvedAddresses) {
      try {
        return executePinned(url, address, deadlineNanos, maximumBytes)
      } catch (failure: IOException) {
        lastFailure = failure
      }
    }
    throw lastFailure ?: IOException("No validated provider address was available")
  }

  private fun executePinned(
    url: URL,
    address: InetAddress,
    deadlineNanos: Long,
    maximumBytes: Int,
  ): RawHttpsResponse {
    Socket().use { plainSocket ->
      plainSocket.connect(InetSocketAddress(address, HTTPS_PORT), remainingMillis(deadlineNanos))
      plainSocket.soTimeout = remainingMillis(deadlineNanos)
      val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
      val tlsSocket =
        factory.createSocket(plainSocket, url.host, HTTPS_PORT, true) as? SSLSocket
          ?: throw SSLHandshakeException("Platform TLS socket unavailable")
      tlsSocket.use { socket ->
        val parameters = socket.sslParameters
        parameters.endpointIdentificationAlgorithm = "HTTPS"
        parameters.serverNames = listOf(SNIHostName(url.host))
        socket.sslParameters = parameters
        socket.soTimeout = remainingMillis(deadlineNanos)
        socket.startHandshake()
        if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(url.host, socket.session)) {
          throw SSLHandshakeException("Official provider hostname verification failed")
        }

        val request =
          buildString {
              append("GET ")
              append(url.path)
              append(" HTTP/1.1\r\nHost: ")
              append(url.host)
              append("\r\nAccept: text/html\r\nAccept-Encoding: identity\r\n")
              append("Connection: close\r\nUser-Agent: FetanAgent-TeleBirr-Verifier/1\r\n\r\n")
            }
            .toByteArray(StandardCharsets.US_ASCII)
        socket.outputStream.write(request)
        socket.outputStream.flush()

        val input = BufferedInputStream(socket.inputStream)
        val headers = readHeaders(input, socket, deadlineNanos)
        val body = readBody(input, socket, deadlineNanos, headers, maximumBytes)
        return RawHttpsResponse(
          statusCode = headers.statusCode,
          contentType = headers.single("content-type"),
          contentEncoding = headers.single("content-encoding"),
          body = body,
        )
      }
    }
  }

  private data class HttpHeaders(
    val statusCode: Int,
    val values: Map<String, List<String>>,
  ) {
    fun single(name: String): String? {
      val candidates = values[name] ?: return null
      require(candidates.size == 1) { "Duplicate security-relevant HTTP header" }
      return candidates.single()
    }
  }

  private fun readHeaders(
    input: BufferedInputStream,
    socket: SSLSocket,
    deadlineNanos: Long,
  ): HttpHeaders {
    val bytes = ByteArrayOutputStream()
    var matched = 0
    while (bytes.size() < MAX_HEADER_BYTES) {
      socket.soTimeout = remainingMillis(deadlineNanos)
      val next = input.read()
      if (next < 0) throw EOFException("Provider closed before HTTP headers completed")
      bytes.write(next)
      matched =
        when {
          next == HEADER_TERMINATOR[matched].toInt() -> matched + 1
          next == HEADER_TERMINATOR[0].toInt() -> 1
          else -> 0
        }
      if (matched == HEADER_TERMINATOR.size) break
    }
    require(matched == HEADER_TERMINATOR.size) { "Provider HTTP headers exceed the bound" }
    val headerText = bytes.toString(StandardCharsets.ISO_8859_1.name())
    val lines = headerText.removeSuffix("\r\n\r\n").split("\r\n")
    val statusMatch = STATUS_LINE.matchEntire(lines.firstOrNull().orEmpty())
      ?: throw IOException("Invalid provider HTTP status line")
    val values = linkedMapOf<String, MutableList<String>>()
    for (line in lines.drop(1)) {
      require(line.isNotEmpty() && line[0] != ' ' && line[0] != '\t') {
        "Invalid folded provider HTTP header"
      }
      val colon = line.indexOf(':')
      require(colon > 0) { "Invalid provider HTTP header" }
      val name = line.substring(0, colon).lowercase()
      require(HEADER_NAME.matches(name)) { "Invalid provider HTTP header name" }
      val value = line.substring(colon + 1).trim()
      require(value.length <= MAX_HEADER_VALUE_CHARACTERS && value.none { it.isISOControl() && it != '\t' }) {
        "Invalid provider HTTP header value"
      }
      values.getOrPut(name) { mutableListOf() } += value
    }
    return HttpHeaders(statusMatch.groupValues[1].toInt(), values)
  }

  private fun readBody(
    input: BufferedInputStream,
    socket: SSLSocket,
    deadlineNanos: Long,
    headers: HttpHeaders,
    maximumBytes: Int,
  ): ByteArray {
    val transferEncoding = headers.single("transfer-encoding")
    val contentLength = headers.single("content-length")
    require(transferEncoding == null || contentLength == null) {
      "Ambiguous provider HTTP framing"
    }
    return when {
      transferEncoding != null -> {
        require(transferEncoding.equals("chunked", ignoreCase = true)) {
          "Unsupported provider transfer encoding"
        }
        readChunked(input, socket, deadlineNanos, maximumBytes)
      }
      contentLength != null -> {
        require(Regex("^(?:0|[1-9][0-9]{0,8})$").matches(contentLength)) {
          "Invalid provider content length"
        }
        val length = contentLength.toInt()
        if (length > maximumBytes) ByteArray(maximumBytes + 1)
        else readExactly(input, socket, deadlineNanos, length)
      }
      else -> readUntilClose(input, socket, deadlineNanos, maximumBytes)
    }
  }

  private fun readChunked(
    input: BufferedInputStream,
    socket: SSLSocket,
    deadlineNanos: Long,
    maximumBytes: Int,
  ): ByteArray {
    val output = ByteArrayOutputStream()
    while (true) {
      val sizeText = readAsciiLine(input, socket, deadlineNanos, 16)
      require(Regex("^[0-9A-Fa-f]{1,8}$").matches(sizeText)) { "Invalid provider chunk size" }
      val chunkSize = sizeText.toLong(16)
      require(chunkSize <= Int.MAX_VALUE) { "Provider chunk is too large" }
      if (chunkSize == 0L) {
        require(readAsciiLine(input, socket, deadlineNanos, 2).isEmpty()) {
          "Provider trailers are not accepted"
        }
        return output.toByteArray()
      }
      if (output.size().toLong() + chunkSize > maximumBytes) return ByteArray(maximumBytes + 1)
      output.write(readExactly(input, socket, deadlineNanos, chunkSize.toInt()))
      require(readAsciiLine(input, socket, deadlineNanos, 2).isEmpty()) {
        "Invalid provider chunk terminator"
      }
    }
  }

  private fun readExactly(
    input: BufferedInputStream,
    socket: SSLSocket,
    deadlineNanos: Long,
    length: Int,
  ): ByteArray {
    val output = ByteArray(length)
    var offset = 0
    while (offset < length) {
      socket.soTimeout = remainingMillis(deadlineNanos)
      val read = input.read(output, offset, length - offset)
      if (read < 0) throw EOFException("Provider body ended early")
      offset += read
    }
    return output
  }

  private fun readUntilClose(
    input: BufferedInputStream,
    socket: SSLSocket,
    deadlineNanos: Long,
    maximumBytes: Int,
  ): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(4_096)
    while (true) {
      socket.soTimeout = remainingMillis(deadlineNanos)
      val read = input.read(buffer)
      if (read < 0) return output.toByteArray()
      if (output.size() + read > maximumBytes) return ByteArray(maximumBytes + 1)
      output.write(buffer, 0, read)
    }
  }

  private fun readAsciiLine(
    input: BufferedInputStream,
    socket: SSLSocket,
    deadlineNanos: Long,
    maximumBytes: Int,
  ): String {
    val output = ByteArrayOutputStream()
    var previous = -1
    while (output.size() <= maximumBytes) {
      socket.soTimeout = remainingMillis(deadlineNanos)
      val next = input.read()
      if (next < 0) throw EOFException("Provider body ended mid-line")
      if (previous == '\r'.code && next == '\n'.code) {
        val bytes = output.toByteArray()
        return String(bytes, 0, bytes.size - 1, StandardCharsets.US_ASCII)
      }
      output.write(next)
      previous = next
    }
    throw IOException("Provider line exceeds the bound")
  }

  private fun remainingMillis(deadlineNanos: Long): Int {
    val remainingNanos = deadlineNanos - System.nanoTime()
    if (remainingNanos <= 0L) throw TimeoutException("Provider HTTPS deadline elapsed")
    return TimeUnit.NANOSECONDS
      .toMillis(remainingNanos)
      .coerceAtLeast(1L)
      .coerceAtMost(Int.MAX_VALUE.toLong())
      .toInt()
  }

  private const val HTTPS_PORT = 443
  private const val MAX_HEADER_BYTES = 16 * 1024
  private const val MAX_HEADER_VALUE_CHARACTERS = 4 * 1024
  private val HEADER_TERMINATOR = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte(), '\r'.code.toByte(), '\n'.code.toByte())
  private val STATUS_LINE = Regex("^HTTP/1\\.[01] ([0-9]{3})(?: .*)?$")
  private val HEADER_NAME = Regex("^[!#$%&'*+.^_`|~0-9a-z-]+$")
}

object PublicInternetAddressPolicy {
  fun isPublic(address: InetAddress): Boolean {
    if (
      address.isAnyLocalAddress ||
        address.isLoopbackAddress ||
        address.isLinkLocalAddress ||
        address.isSiteLocalAddress ||
        address.isMulticastAddress
    ) {
      return false
    }
    val bytes = address.address
    return when (address) {
      is Inet4Address -> isPublicIpv4(bytes)
      is Inet6Address -> isPublicIpv6(bytes)
      else -> false
    }
  }

  private fun isPublicIpv4(bytes: ByteArray): Boolean {
    val first = bytes[0].toInt() and 0xff
    val second = bytes[1].toInt() and 0xff
    val third = bytes[2].toInt() and 0xff
    return when {
      first == 0 || first == 10 || first == 127 || first >= 224 -> false
      first == 100 && second in 64..127 -> false
      first == 169 && second == 254 -> false
      first == 172 && second in 16..31 -> false
      first == 192 && second == 0 && third == 0 -> false
      first == 192 && second == 0 && third == 2 -> false
      first == 192 && second == 88 && third == 99 -> false
      first == 192 && second == 168 -> false
      first == 198 && second in 18..19 -> false
      first == 198 && second == 51 && third == 100 -> false
      first == 203 && second == 0 && third == 113 -> false
      else -> true
    }
  }

  private fun isPublicIpv6(bytes: ByteArray): Boolean {
    val first = bytes[0].toInt() and 0xff
    val second = bytes[1].toInt() and 0xff
    val isGlobalUnicast = first in 0x20..0x3f
    val documentation = first == 0x20 && second == 0x01 && bytes[2] == 0x0d.toByte() && bytes[3] == 0xb8.toByte()
    return isGlobalUnicast && !documentation
  }
}
