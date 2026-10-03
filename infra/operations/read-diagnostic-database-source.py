# Runs over the existing verified SSH connection; emits private stdout only.
import ipaddress
import json
import re
import socket
import subprocess
import sys

def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"db\.[a-z0-9]{20}\.supabase\.co", sys.argv[1]):
        raise ValueError()
    addresses = socket.getaddrinfo(sys.argv[1], 5432, type=socket.SOCK_STREAM)
    destination = next(item[4][0] for item in addresses if item[0] == socket.AF_INET6)
    result = subprocess.run(["ip", "-6", "-j", "route", "get", destination],
                            capture_output=True, text=True, timeout=5, check=True)
    routes = json.loads(result.stdout)
    if len(routes) != 1:
        raise ValueError()
    source = ipaddress.ip_address(routes[0].get("prefsrc") or routes[0].get("src"))
    if source.version != 6 or not source.is_global:
        raise ValueError()
    print(str(source))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("Production source inspection unavailable.\n")
        raise SystemExit(1)
