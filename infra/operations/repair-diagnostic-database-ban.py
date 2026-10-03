# One narrowly scoped repair using existing protected management access.
import ipaddress
import json
import os
import re
import subprocess
import sys

class RepairFailure(Exception):
    pass

def require(value):
    if not value:
        raise RepairFailure()

def read_bans(project, cli):
    raw = cli(["network-bans", "get", "--project-ref", project,
               "--experimental", "--output", "json"])
    require(len(raw) <= 65536)
    values = json.loads(raw)
    require(isinstance(values, list) and all(isinstance(value, str) for value in values))
    return {ipaddress.ip_address(value) for value in values}

def repair(project, source, cli):
    require(isinstance(project, str) and re.fullmatch(r"[a-z0-9]{20}", project))
    address = ipaddress.ip_address(source)
    require(address.version == 6 and address.is_global)
    before = read_bans(project, cli)
    if address not in before:
        return False
    cli(["network-bans", "remove", "--project-ref", project,
         "--db-unban-ip", str(address), "--experimental"])
    after = read_bans(project, cli)
    require(address not in after and after.issubset(before - {address}))
    return True

def main():
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    require(bool(token))
    environment = {key: os.environ[key] for key in ("PATH", "HOME") if key in os.environ}
    environment.update(SUPABASE_ACCESS_TOKEN=token, NO_COLOR="1")
    def cli(arguments):
        result = subprocess.run(["supabase", *arguments], capture_output=True,
                                text=True, timeout=25, env=environment)
        require(result.returncode == 0)
        return result.stdout
    removed = repair(os.environ.get("FETANAGENT_DIAGNOSTIC_PROJECT_REF"),
                     os.environ.get("FETANAGENT_DIAGNOSTIC_SOURCE_IP"), cli)
    print(json.dumps({"component": "fetanagent_diagnostic_connection_repair",
                      "result": "passed", "hostBanRemoved": removed,
                      "otherAccessUnchanged": True, "moneyMoved": False,
                      "identifiersRedacted": True}, separators=(",", ":")))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("The bounded database connection repair was refused.\n")
        raise SystemExit(1)
