package com.fetanagent.telebirrverifier

import java.net.InetAddress
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
        exchange = HttpsExchange { _, _, _, _ ->
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
        exchange = HttpsExchange { _, _, _, _ ->
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
        exchange = HttpsExchange { _, _, _, _ ->
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
          exchange = HttpsExchange { _, _, _, _ -> response },
        )
      assertTrue(transport.retrieve(route()) is ProviderDocument.Unavailable)
    }
  }

  @Test
  fun `fails closed when the total deadline elapses`() {
    var now = 1_000L
    val clock = MillisClock { now }
    val transport =
      SafeOfficialReceiptTransport(
        resolver = publicResolver,
        exchange = HttpsExchange { _, _, _, _ ->
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
        exchange = HttpsExchange { _, addresses, timeout, maximumBytes ->
          assertEquals(listOf("8.8.8.8"), addresses.map(InetAddress::getHostAddress))
          assertTrue(timeout in 1..SafeOfficialReceiptTransport.TOTAL_TIMEOUT_MILLIS)
          assertEquals(SafeOfficialReceiptTransport.MAX_RESPONSE_BYTES, maximumBytes)
          RawHttpsResponse(200, "text/html; Charset=\"UTF-8\"", "identity", html.toByteArray())
        },
        clock = MillisClock { 1_778_000_000_000L },
      )
    val result = transport.retrieve(route()) as ProviderDocument.Found

    assertEquals(html, result.utf8Body)
  }

  private fun route(): OfficialReceiptRoute =
    OfficialReceiptRoute.forReference(CanonicalReference.fromCanonical(SYNTHETIC_REFERENCE))
}
