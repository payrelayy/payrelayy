# Production availability monitor

This host-based monitor checks infrastructure only. It cannot certify customer operations,
account recovery, payment processing, or product readiness. It neither accesses the database nor
performs provider actions, and it never restarts services or changes financial restrictions.

## Checks and notifications

Every 60 seconds, the oneshot service reads narrowly formatted Docker metadata for the ten exact
`fetanagent-production` services, checks disk usage at `/srv/fetanagent/production`, and makes three
unauthenticated HTTPS GETs: `https://fetanagent.com/`, `https://fetanagent.com/sign-in`, and
`https://owner.fetanagent.com/owner`. TLS verification is required; redirects are not followed.
Responses must be HTTP 200 HTML with the expected page marker, within a 512 KiB body limit.
Docker output is bounded to 16 KiB. No response bodies, container environment, logs, customer
identifiers, passwords or tokens are emitted or included in email.

Disk use is a warning at 85% and critical at 95%; both count as failed availability checks.
Three consecutive failing runs open an incident. The configured Owner receives one outage email;
continuing incidents receive reminders no more often than hourly. Two healthy runs qualify for a
recovery email. Delivery retries have a five-minute minimum interval, so recovery can be delayed
by the most recent notification attempt. Changing symptoms during an incident does not bypass
the reminder limit. An interrupted/uncertain SMTP operation can cause a later duplicate; this is
rate-limited best-effort notification, not exactly-once delivery.

SMTP acceptance is not proof of inbox delivery. Verify the first explicitly labelled service-test
email in the intended Owner inbox or Mailgun delivery logs. A complete VM failure, stopped timer,
lost outbound network, or unavailable Mailgun account can prevent alerts: an independently hosted
external uptime check is still needed for full-host outage coverage.

## Protected configuration and installation boundary

The installer/operator must place the reviewed script at
`/usr/local/lib/fetanagent/fetanagent-availability-monitor.py` and the matching service/timer units
in the systemd unit directory. No installation, timer activation, or email is performed by merely
adding these files to Git. Use a root-owned, non-writable-by-others script and unit files.

SMTP configuration lives only at `/etc/fetanagent/availability-monitor/smtp.json`, a root:root
regular file with mode `0600`, inside a root-controlled directory. It has exactly six fields:
`host`, `port`, `from`, `to`, `user`, `password`. `host` must be `smtp.eu.mailgun.org` and `port`
must be integer `2525`; the three addresses must be single mailboxes, with no display names or
newline characters. Use an approved verified sender, the existing Owner recipient, and a protected
Mailgun SMTP credential. Do not commit a populated configuration or print it in commands, logs,
screenshots, issues or this documentation. Authentication is attempted only after verified
STARTTLS. Mailgun account/plan eligibility must be checked before installation; this code does not
purchase a service, alter SMTP account settings or change the application's authentication email.

This is a fixed endpoint, not a configurable port allowlist or an automatic fallback. DigitalOcean
[blocks standard SMTP ports 25, 465 and 587 on Droplets](https://docs.digitalocean.com/support/why-is-smtp-blocked/).
Mailgun's [port 2525 supports STARTTLS](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp),
and this monitor requires certificate and hostname verification before sending credentials on it.
Missing STARTTLS or certificate failure stops delivery; it never falls back to plaintext, another
host or another port. Confirm credential-free TLS connectivity from the production host before the
first authorized email test. A successful authentication email from a different service does not
establish connectivity from this VM.

State and a nonblocking process lock live in `/var/lib/fetanagent-availability-monitor`, mode
`0700`, owned by root:root. State updates use atomic replacement and filesystem synchronization.
Malformed, unsafe or future-dated state fails closed rather than resetting notification history.
Preserve and investigate damaged state; do not silently delete it to clear an incident. The script
has a 45-second total deadline and systemd enforces 50 seconds. Root is necessary to inspect the
local Docker socket; access to that socket remains a privileged trust boundary despite unit
hardening. The command allowlist contains only container inspection, never Docker mutation.

## Operator validation

- `--check-only` performs the read-only probes without loading SMTP credentials, writing state or
  sending email; it emits only fixed issue identifiers. Exit 0 means healthy, 1 means a failed
  availability check, and 2 means monitor/configuration/delivery failure.
- `--send-test` explicitly sends a message labelled **SERVICE TEST — no outage asserted**. It is
  rate-limited, records the test attempt, and does not open or clear an incident.
- Normal mode evaluates counters and sends only an eligible incident/recovery/reminder message.
- A second simultaneous invocation exits quietly with `already_running`; it cannot duplicate the
  first invocation's work. Fixed journal event identifiers contain no exception or credential text.
- Validate units before enabling the timer, confirm all ten services and the three page checks,
  verify the test email reaches the approved recipient, and retain safe delivery metadata.

The implementation uses Python's standard-library
[verified STARTTLS support](https://docs.python.org/3/library/smtplib.html#smtplib.SMTP.starttls)
and [HTTPS client](https://docs.python.org/3/library/http.client.html#http.client.HTTPSConnection).
Unit tests replace network, Docker, clock, disk and email calls; they do not contact live services.
