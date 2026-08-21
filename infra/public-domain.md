# FetanAgent public domain runbook

The safe DNS and HTTPS architecture keeps Porkbun authoritative for `fetanagent.com`, preserves the
existing Porkbun email-forwarding records, and exposes only a hardened Caddy gateway. The gateway
serves the static landing page at `fetanagent.com` and proxies only the authenticated Owner-control
page at `owner.fetanagent.com`. The API, beta admission, bot, PostgreSQL, and Docker socket remain
unpublished.

## Why Porkbun remains authoritative

Do not change the registrar nameservers to DigitalOcean. The current Porkbun zone contains MX and
SPF records used by email forwarding; moving authority before reproducing and validating those
records can interrupt mail. DigitalOcean may continue to show an unused zone, but its records have
no effect while the Porkbun nameservers are authoritative.

Official references:

- [Porkbun: add DNS records](https://kb.porkbun.com/article/231-how-to-add-dns-records-on-porkbun)
- [Porkbun: email forwarding](https://kb.porkbun.com/article/10-how-to-set-up-email-forwarding-service)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

## Required firewall gate

Before changing DNS, attach a DigitalOcean Cloud Firewall to Droplet `593344964` with inbound TCP
rules for 80 and 443 from all IPv4 and IPv6 addresses. Retain the existing SSH rule; do not expose a
database, Docker daemon, or application port. Add matching UFW rules for `80/tcp` and `443/tcp` on
the VM. Docker-published ports can bypass ordinary UFW forwarding rules, so the DigitalOcean Cloud
Firewall is a required outer boundary, not an optional duplicate.

No UDP 443 rule is required. The reviewed Caddy configuration disables HTTP/3 and permits only
HTTP/1.1 and HTTP/2.

The gateway runs as numeric UID/GID `10001`, with a read-only root filesystem and no application
secret. Its only writable paths are `/var/lib/fetanagent-gateway/data` and
`/var/lib/fetanagent-gateway/config`, created by the root-owned deployment helper with mode `0700`.
Those paths preserve ACME account and certificate state across bounded gateway replacement.

## Porkbun records

Preserve every MX, SPF TXT, and `_acme-challenge` TXT record. Do not use **Delete all records**.
Delete only the Porkbun parking records that conflict with the explicit hosts, then create:

| Type  | Host    | Answer / value   | TTL |
| ----- | ------- | ---------------- | --- |
| A     | blank   | `161.35.41.232`  | 600 |
| A     | `owner` | `161.35.41.232`  | 600 |
| CNAME | `www`   | `fetanagent.com` | 600 |

Do not add an AAAA record during the initial cutover. Add IPv6 only after public HTTPS has been
independently verified over IPv6. Remove the wildcard Porkbun parking CNAME only if it conflicts
with the explicit `owner` or `www` records; it is not needed by FetanAgent.

## Fail-closed publication sequence

1. Merge a reviewed commit containing the gateway and run the existing private
   `deploy-and-smoke`. This transfers the gateway image but does not start it because the gateway
   belongs only to the `public-domain` profile.
2. Configure the DigitalOcean Cloud Firewall and UFW rules.
3. Add the three Porkbun DNS records and wait until all three names resolve only to
   `161.35.41.232`.
4. After the separately reviewed Telegram activation gate passes, run `Staging public domain edge`
   in `inspect` mode with the exact main commit, domain, and Droplet ID. It proves the exact
   four-service private set, the root-owned startup receipt bound to the exact genuine zero-restart
   bot container, every fail-closed runtime value, Droplet metadata identity, DNS, UFW rules, free
   public ports, and gateway image without making a container change.
5. Only after inspection passes, run the same workflow in `publish` mode. It starts only the
   secret-free gateway and performs bounded public TLS smoke checks.
6. If the smoke fails, the workflow removes the gateway automatically. The private bot and Owner
   service remain unchanged.

The workflow `stop` mode removes only the public gateway. It does not delete certificate state,
stop the private beta, disable database logins, or modify DNS. Remove or park the DNS records
separately if the public endpoint must remain unavailable for an extended incident.
