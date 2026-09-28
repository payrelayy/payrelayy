"""Read-only, no-credential network/TLS probe for the production operator host.

The caller supplies the exact database hostname and public CA in a prefix on
stdin, before this source. No hostname, address, or exception text is emitted.
"""

import errno
import socket
import ssl
import struct


try:
    with open("/proc/sys/net/ipv4/ip_unprivileged_port_start", encoding="ascii") as setting:
        minimum_unprivileged_port = int(setting.read().strip())
    loopback_bind = "allowed_without_cap" if minimum_unprivileged_port <= 743 else "requires_cap"
except (OSError, ValueError):
    loopback_bind = "unavailable"
print("operator_loopback_bind=" + loopback_bind)


def addresses(family):
    try:
        return socket.getaddrinfo(host, 5432, family, socket.SOCK_STREAM)
    except socket.gaierror:
        return []


ipv4 = addresses(socket.AF_INET)
ipv6 = addresses(socket.AF_INET6)
print("dns_a=" + ("present" if ipv4 else "absent"))
print("dns_aaaa=" + ("present" if ipv6 else "absent"))

if not ipv6:
    print("direct_ipv6_tcp=not_attempted")
else:
    result = "other_failure"
    address = ipv6[0][4]
    try:
        with socket.socket(socket.AF_INET6, socket.SOCK_STREAM) as connection:
            connection.settimeout(5)
            connection.connect(address)
        result = "reachable"
    except TimeoutError:
        result = "timeout"
    except OSError as error:
        result = {
            errno.ENETUNREACH: "network_unreachable",
            errno.EHOSTUNREACH: "host_unreachable",
            errno.ECONNREFUSED: "refused",
            errno.ETIMEDOUT: "timeout",
        }.get(error.errno, "other_failure")
    print("direct_ipv6_tcp=" + result)

tls_result = "not_attempted"
if ipv6 and result == "reachable":
    try:
        with socket.socket(socket.AF_INET6, socket.SOCK_STREAM) as connection:
            connection.settimeout(5)
            connection.connect(ipv6[0][4])
            connection.sendall(struct.pack("!II", 8, 80877103))
            if connection.recv(1) != b"S":
                tls_result = "not_offered"
            else:
                context = ssl.create_default_context(cadata=ca_pem)
                with context.wrap_socket(connection, server_hostname=host):
                    tls_result = "verified"
    except ssl.SSLCertVerificationError:
        tls_result = "certificate_rejected"
    except ssl.SSLError:
        tls_result = "handshake_failed"
    except TimeoutError:
        tls_result = "timeout"
    except (OSError, ValueError):
        tls_result = "transport_or_ca_failure"
print("direct_tls=" + tls_result)
