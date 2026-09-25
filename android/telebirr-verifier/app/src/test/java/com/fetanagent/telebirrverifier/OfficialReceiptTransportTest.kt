package com.fetanagent.telebirrverifier

import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class OfficialReceiptTransportTest {
  private val publicResolver = HostResolver { _, _ -> listOf(InetAddress.getByName("8.8.8.8")) }

  @Test
  fun `builds only the fixed official HTTPS route from a canonical reference`() {
    val reference = CanonicalReference.fromCanonical(SYNTHETIC_REFERENCE)
    val route = OfficialReceiptRoute.forReference(reference)
    val url = route.useUrl { it.toExternalForm() }

    assertEquals("https://transactioninfo.ethiotelecom.et/receipt/$SYNTHETIC_REFERENCE", url)
    assertFalse(route.toString().contains(SYNTHETIC_REFERENCE))
    assertThrows(IllegalArgumentException::class.java) {
      CanonicalReference.fromCanonical("test9abc1234")
    }
    assertThrows(IllegalArgumentException::class.java) {
      CanonicalReference.fromCanonical("TEST9ABC1234/redirect")
    }
  }

  @Test
  fun `rejects redirects without following them`() {
    var calls = 0
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { _, _, _, _, _ ->
          calls += 1
          RawHttpsResponse(302, "text/html; charset=utf-8", null, ByteArray(0))
        },
      )
    val result = transport.retrieve(route())

    assertEquals(1, calls)
    assertEquals("provider", (result as ProviderDocument.Unavailable).uncertainty)
  }

  @Test
  fun `treats a bare 404 as uncertainty rather than a definitive missing receipt`() {
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { _, _, _, _, _ ->
          RawHttpsResponse(404, "text/html; charset=utf-8", null, ByteArray(0))
        },
      )

    val result = transport.retrieve(route())

    assertEquals("provider", (result as ProviderDocument.Unavailable).uncertainty)
  }

  @Test
  fun `rejects private or mixed DNS answers before HTTPS`() {
    var called = false
    val transport =
      SafeOfficialReceiptTransport(
        resolver =
          HostResolver { _, _ ->
            listOf(InetAddress.getByName("8.8.8.8"), InetAddress.getByName("10.0.0.1"))
          },
        exchange = HttpsExchange { _, _, _, _, _ ->
          called = true
          RawHttpsResponse(200, "text/html", null, "ok".toByteArray())
        },
      )
    val result = transport.retrieve(route())

    assertFalse(called)
    assertEquals("network", (result as ProviderDocument.Unavailable).uncertainty)
    assertFalse(PublicInternetAddressPolicy.isPublic(InetAddress.getByName("127.0.0.1")))
    assertFalse(PublicInternetAddressPolicy.isPublic(InetAddress.getByName("2001:db8::1")))
    assertTrue(PublicInternetAddressPolicy.isPublic(InetAddress.getByName("2606:4700:4700::1111")))
  }

  @Test
  fun `rejects oversized unsupported encoded and non UTF8 responses`() {
    val cases =
      listOf(
        RawHttpsResponse(200, "text/html", null, ByteArray(SafeOfficialReceiptTransport.MAX_RESPONSE_BYTES + 1)),
        RawHttpsResponse(200, "application/json", null, "{}".toByteArray()),
        RawHttpsResponse(200, "text/html; charset=iso-8859-1", null, "ok".toByteArray()),
        RawHttpsResponse(200, "text/html; charset=utf-8", "gzip", "ok".toByteArray()),
        RawHttpsResponse(200, "text/html; charset=utf-8", null, byteArrayOf(0xc3.toByte(), 0x28)),
      )
    for (response in cases) {
      val transport =
        SafeOfficialReceiptTransport(
          resolver = publicResolver,
          exchange = HttpsExchange { _, _, _, _, _ -> response },
        )
      assertTrue(transport.retrieve(route()) is ProviderDocument.Unavailable)
    }
  }

  @Test
  fun `fails closed when the total deadline elapses`() {
    assertEquals(15_000, SafeOfficialReceiptTransport.TOTAL_TIMEOUT_MILLIS)
    var now = 1_000L
    val clock = MillisClock { now }
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { _, _, _, _, _ ->
          now += SafeOfficialReceiptTransport.TOTAL_TIMEOUT_MILLIS + 1
          RawHttpsResponse(200, "text/html; charset=utf-8", null, officialHtml().toByteArray())
        },
        clock = clock,
      )
    val result = transport.retrieve(route())

    assertEquals("network", (result as ProviderDocument.Unavailable).uncertainty)
  }

  @Test
  fun `accepts only a bounded successful UTF8 HTML response`() {
    val html = officialHtml()
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { _, addresses, timeout, maximumBytes, _ ->
          assertEquals(listOf("8.8.8.8"), addresses.map(InetAddress::getHostAddress))
          assertTrue(timeout in 1..SafeOfficialReceiptTransport.TOTAL_TIMEOUT_MILLIS)
          assertEquals(SafeOfficialReceiptTransport.MAX_RESPONSE_BYTES, maximumBytes)
          RawHttpsResponse(200, "text/html; Charset=\"UTF-8\"", "identity", html.toByteArray())
        },
        clock = MillisClock { 1_778_000_000_000L },
      )
    val result = transport.retrieve(route()) as ProviderDocument.Found

    assertEquals(html, result.utf8Body)
    assertEquals(
      ProviderDocumentOriginAttestation.OFFICIAL_TLS_ORIGIN,
      result.originAttestation,
    )
  }

  @Test
  fun `rechecks one brief unmarked page within the same official route and deadline`() {
    val brief = "<html><body>Temporarily empty</body></html>"
    val full = officialHtml()
    val diagnostics = mutableListOf<ReceiptResponseDiagnostic>()
    var calls = 0
    var now = 1_000L
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { url, addresses, timeout, maximumBytes, _ ->
          calls += 1
          assertEquals("https://transactioninfo.ethiotelecom.et/receipt/$SYNTHETIC_REFERENCE", url.toString())
          assertEquals(listOf("8.8.8.8"), addresses.map(InetAddress::getHostAddress))
          assertEquals(SafeOfficialReceiptTransport.MAX_RESPONSE_BYTES, maximumBytes)
          assertEquals(SafeOfficialReceiptTransport.TOTAL_TIMEOUT_MILLIS - (calls - 1) * 100, timeout)
          now += 100
          RawHttpsResponse(200, "text/html; charset=utf-8", null, (if (calls == 1) brief else full).toByteArray())
        },
        clock = MillisClock { now },
        responseDiagnostics = ReceiptResponseDiagnostics { diagnostics += it },
      )

    val result = transport.retrieve(route()) as ProviderDocument.Found

    assertEquals(2, calls)
    assertEquals(full, result.utf8Body)
    assertEquals(CanonicalTranscripts.sha256(full.toByteArray()), result.sourceDocumentDigest)
    assertEquals(2, diagnostics.size)
    assertEquals("brief", diagnostics[0].bodyBytesBand)
    assertTrue(diagnostics[1].bodyBytesBand != "brief")
    assertTrue(diagnostics.none { it.toString().contains(SYNTHETIC_REFERENCE) })
  }

  @Test
  fun `a second brief response is terminal for this observation`() {
    val brief = "<html><body>Temporarily empty</body></html>"
    var calls = 0
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { _, _, _, _, _ ->
          calls += 1
          RawHttpsResponse(200, "text/html", null, brief.toByteArray())
        },
      )

    val result = transport.retrieve(route()) as ProviderDocument.Found

    assertEquals(2, calls)
    assertEquals(brief, result.utf8Body)
  }

  @Test
  fun `the brief-page recheck cannot outlive the original total deadline`() {
    var calls = 0
    var now = 1_000L
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { _, _, _, _, _ ->
          calls += 1
          now += SafeOfficialReceiptTransport.TOTAL_TIMEOUT_MILLIS
          RawHttpsResponse(200, "text/html", null, "<html></html>".toByteArray())
        },
        clock = MillisClock { now },
      )

    assertEquals("network", (transport.retrieve(route()) as ProviderDocument.Unavailable).uncertainty)
    assertEquals(1, calls)
  }

  @Test
  fun `does not retry a short challenge session redirect or receipt marker`() {
    val cases =
      listOf(
        RawHttpsResponse(200, "text/html", null, "<html>Access denied</html>".toByteArray()),
        RawHttpsResponse(200, "text/html", null, "<html>Sign in</html>".toByteArray()),
        RawHttpsResponse(200, "text/html", null, "<html><script></script></html>".toByteArray()),
        RawHttpsResponse(200, "text/html", null, "<html>Invoice No</html>".toByteArray()),
        RawHttpsResponse(200, "text/html", null, "<html></html>".toByteArray(), setCookieHeader = true),
        RawHttpsResponse(200, "text/html", null, "<html></html>".toByteArray(), varyUserAgentHeader = true),
        RawHttpsResponse(200, "text/html", null, "<html></html>".toByteArray(), authenticationHeader = true),
        RawHttpsResponse(200, "text/html", null, "<html></html>".toByteArray(), refreshHeader = true),
      )
    for (response in cases) {
      var calls = 0
      val transport =
        SafeOfficialReceiptTransport(
          resolver = publicResolver,
          exchange = HttpsExchange { _, _, _, _, _ ->
            calls += 1
            response
          },
        )

      assertTrue(transport.retrieve(route()) is ProviderDocument.Found)
      assertEquals(1, calls)
    }
  }

  @Test
  fun `a rejected second response cannot reuse the first page as evidence`() {
    var calls = 0
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { _, _, _, _, _ ->
          calls += 1
          if (calls == 1) RawHttpsResponse(200, "text/html", null, "<html></html>".toByteArray())
          else RawHttpsResponse(302, "text/html", null, ByteArray(0))
        },
      )

    assertEquals("provider", (transport.retrieve(route()) as ProviderDocument.Unavailable).uncertainty)
    assertEquals(2, calls)
  }

  @Test
  fun `reports only fixed response categories without provider text or header values`() {
    val html = "<html><body>Access denied for a synthetic request</body></html>"
    val observed = mutableListOf<ReceiptResponseDiagnostic>()
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange =
          HttpsExchange { _, _, _, _, _ ->
            RawHttpsResponse(
              200,
              "text/html; charset=utf-8",
              null,
              html.toByteArray(),
              setCookieHeader = true,
              varyCookieHeader = true,
              varyUserAgentHeader = true,
              authenticationHeader = false,
              refreshHeader = false,
            )
          },
        responseDiagnostics = ReceiptResponseDiagnostics { observed += it },
      )

    assertTrue(transport.retrieve(route()) is ProviderDocument.Found)
    val diagnostic = observed.single()
    assertEquals("brief", diagnostic.bodyBytesBand)
    assertEquals("access_words", diagnostic.bodyWordHint)
    assertTrue(diagnostic.setCookieHeader)
    assertTrue(diagnostic.varyCookieHeader)
    assertTrue(diagnostic.varyUserAgentHeader)
    assertFalse(diagnostic.authenticationHeader)
    assertFalse(diagnostic.refreshHeader)
    assertFalse(diagnostic.toString().contains("Access denied"))
    assertFalse(diagnostic.toString().contains(SYNTHETIC_REFERENCE))
    assertFalse(
      RawHttpsResponse(200, "secret-content-type", "secret-content-encoding", html.toByteArray())
        .toString()
        .contains("secret-content"),
    )
  }

  @Test
  fun `response diagnostic callback failure cannot change the attested observation`() {
    val html = officialHtml()
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange =
          HttpsExchange { _, _, _, _, _ ->
            RawHttpsResponse(200, "text/html", null, html.toByteArray())
          },
        responseDiagnostics =
          ReceiptResponseDiagnostics { _ -> throw IllegalStateException("sensitive diagnostic failure") },
      )

    assertEquals(html, (transport.retrieve(route()) as ProviderDocument.Found).utf8Body)
  }

  @Test
  fun `reports only fixed DNS and HTTPS failure classifications`() {
    val observed = mutableListOf<Pair<ReceiptTransportPhase, ReceiptTransportFailure>>()
    val diagnostic = ReceiptTransportDiagnostics { phase, failure -> observed += phase to failure }
    val cases =
      listOf(
        Triple(
          HostResolver { _, _ -> throw UnknownHostException() },
          HttpsExchange { _, _, _, _, _ -> error("HTTPS must not run") },
          ReceiptTransportPhase.DNS to ReceiptTransportFailure.IO_ERROR,
        ),
        Triple(
          publicResolver,
          HttpsExchange { _, _, _, _, trace ->
            trace.advance(ReceiptTransportPhase.TLS)
            throw SSLHandshakeException("sensitive exception detail")
          },
          ReceiptTransportPhase.TLS to ReceiptTransportFailure.TLS_ERROR,
        ),
        Triple(
          publicResolver,
          HttpsExchange { _, _, _, _, trace ->
            trace.advance(ReceiptTransportPhase.BODY)
            throw SocketTimeoutException("sensitive exception detail")
          },
          ReceiptTransportPhase.BODY to ReceiptTransportFailure.TIMEOUT,
        ),
      )
    for ((resolver, exchange, expected) in cases) {
      val transport =
        SafeOfficialReceiptTransport(
          resolver = resolver,
          exchange = exchange,
          diagnostics = diagnostic,
        )
      assertEquals("network", (transport.retrieve(route()) as ProviderDocument.Unavailable).uncertainty)
      assertEquals(expected, observed.removeAt(0))
      assertTrue(observed.isEmpty())
    }
  }

  @Test
  fun `diagnostic callback failure cannot change the fail closed observation`() {
    val transport =
      SafeOfficialReceiptTransport(
        resolver = HostResolver { _, _ -> throw UnknownHostException() },
        diagnostics =
          ReceiptTransportDiagnostics { _, _ ->
            throw IllegalStateException("sensitive diagnostic failure")
          },
      )

    assertEquals("network", (transport.retrieve(route()) as ProviderDocument.Unavailable).uncertainty)
  }

  private fun route(): OfficialReceiptRoute =
    OfficialReceiptRoute.forReference(CanonicalReference.fromCanonical(SYNTHETIC_REFERENCE))
}
