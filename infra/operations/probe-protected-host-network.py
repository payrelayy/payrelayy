"""Read-only, no-credential TCP probe for the production operator host.

The caller supplies the exact database hostname in this script's first line on
stdin, before this source. No hostname, address, or exception text is emitted.
"""

import errno
import socket


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
