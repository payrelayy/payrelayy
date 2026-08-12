# IPv6 direct-database maintenance plan

This runbook prepares a future, explicitly approved maintenance window for DigitalOcean Droplet
`590666364`. It is not authorization to power off the Droplet, enable IPv6, change Netplan, restart
Docker, open a firewall rule, or deploy PayReplayy.

## Why this is required

The free staging project's direct PostgreSQL endpoint is IPv6-only. The application database URLs
are pinned to `db.spzpiyxheappsfyswewl.supabase.co:5432`; session-pooler runtime URLs fail closed.
GitHub Actions may still use the IPv4 pooler for short-lived administrator SQL, but application
preflights and services run only from this VM over direct IPv6.

## Pre-maintenance evidence

Before requesting the outage:

1. Confirm the latest DigitalOcean backup is `available` and record its image ID and creation time.
2. Confirm SSH key access and DigitalOcean Recovery Console access independently.
3. Run the staging `stop-and-disable` workflow and prove zero PayReplayy containers and zero runtime
   database sessions.
4. Capture the current IPv4 address, Netplan files, IPv4 default route, UFW status, and Docker
   network inventory without reading secrets.
5. Keep TCP/22 as the only accepted public inbound rule. Do not add PostgreSQL, HTTP, or HTTPS
   ingress.

## Approved maintenance sequence

DigitalOcean requires the existing Droplet to be powered off before IPv6 is enabled. The exact
assigned IPv6 address, gateway, and prefix must be copied from the DigitalOcean control plane at
execution time; they must never be guessed or committed to this repository.

1. Power off the exact Droplet through the DigitalOcean control plane.
2. Enable IPv6 for that Droplet. Treat this as an irreversible account-side setting.
3. Power the Droplet on and use the Recovery Console if ordinary SSH does not return.
4. Add the exact assigned IPv6 values to a separate Netplan file while preserving all existing IPv4
   configuration. Validate with `netplan generate` and bounded `netplan try` before applying.
5. Verify ordinary IPv4 SSH still works, then verify one global IPv6 address and one IPv6 default
   route. Do not change the inbound UFW allowlist.
6. Confirm the exact staging hostname resolves to IPv6 and TCP/5432 is reachable with no credential.
7. Do not change Docker daemon-wide settings. The reviewed Compose file enables IPv6 only on its two
   project-scoped bridge networks; Docker Engine 29 supplies their private IPv6 prefixes.
8. Install the exact reviewed deployment helper and run only its `network-ready` command. It must
   fail closed unless the global address, default route, and exact DNS target are present.

## Post-maintenance acceptance

Do not deploy merely because IPv6 is enabled. A later `deploy-and-smoke` run must create fresh
project networks and pass the Owner-control, Player-ID action, and beta-admission catalog preflights
in disposable containers before starting any long-lived service. Confirm that IPv4 SSH remains the
only public listener and that no firewall or reverse-proxy rule was added.

## Stop and recovery boundary

If SSH, routing, DNS, certificate validation, or any disposable preflight fails, stop. Disable and
clear any temporary staging database logins, remove the PayReplayy Compose project, and retain IPv4
SSH for investigation. Do not weaken TLS, use a pooler runtime URL, expose a port, or retry rapidly.
DigitalOcean IPv6 cannot be disabled after enablement; recovery therefore means restoring the guest
network configuration and service inactivity, not attempting to remove the account-side feature.
