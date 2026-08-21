# CBE Birr authoritative-receipt transport boundary

`@fetanagent/cbe-birr-authoritative-receipt-transport` is an unwired, package-only transport for
the fixed CBE Birr official-receipt route. It can perform at most one request when called with an
exact request-scoped control. No application imports it, and no configuration, worker, database,
queue, deployment, or feature switch makes the request reachable.

The package does not parse receipt fields or produce authoritative evidence. Every result fixes
`responseContractAttested`, `receiptFieldParsingAllowed`, `authoritativeAdapterAllowed`,
`evidenceClaimAllowed`, `duplicateClaimAllowed`, `databaseAccessAllowed`, `persistenceAllowed`,
`runtimeWiringAllowed`, `settlementAllowed`, and `financialActionAllowed` to literal `false`. A
success has disposition `opaque_pdf_observation`; it is not a verified, accepted, claimed, or
settled receipt.

## Fixed request and network policy

The request target remains compiled from the Stage 1E source policy:

```text
GET https://cbepay1.cbe.com.et:443/aureceipt?TID=<REFERENCE>&PH=<RECEIVER_PHONE>
```

Callers can supply only a canonical uppercase 8--32 character ASCII-alphanumeric reference and
the exact 12-digit international receiver selector (`251` plus nine decimal digits). There is no
receiver-name input. Callers cannot select the method, scheme, host, port, path, query names, query
order, headers, redirect target, TLS policy, timeout, response bounds, or retry count.

The transport enforces:

- one attempt and a 5,000 ms total deadline covering DNS, connection, headers, and body;
- operating-system DNS resolution followed by rejection of non-public, special-use,
  documentation, loopback, link-local, carrier-grade NAT, multicast, transition, mapped, and
  private addresses; IPv6 answers must first be inside an `ALLOCATED` prefix in IANA's IPv6 Global
  Unicast Address Space registry snapshot last updated 2025-10-10 and then pass the narrower
  special-use denylist; unlisted `2000::/3` space is IANA-reserved and fails closed until a reviewed
  registry update adds any future allocation;
- pinning the HTTPS connection to one already checked address while retaining the official
  hostname for SNI and certificate-identity validation;
- normal certificate validation, a minimum TLS version of 1.2, no custom CA or credential, and a
  fresh non-pooled connection;
- no redirects, cookies, authorization, decompression, browser session, or response location;
- at most one bounded `Content-Disposition` value containing no ASCII control character, including
  horizontal tab, accepted only as ignored metadata and never returned, logged, parsed, or trusted;
- at most 32 response-header pairs and 8,192 encoded header bytes;
- status `200`, media type `application/pdf` with no parameters, and absent or `identity` content
  encoding only;
- a canonical, non-conflicting `Content-Length` when present, with no simultaneous
  `Transfer-Encoding`; and
- 64 through 1,048,576 actual response bytes, including streamed responses without
  `Content-Length`.

The public call also requires exact `providerRequest` and incident-stop controls. Disabled
requests or an open incident stop return before a sensitive request plan is constructed. The
package does not read these controls from environment variables or configuration; trusted rollout
authorization and operational incident-stop ownership remain later work.

## Opaque PDF observation only

An accepted body must begin exactly with `%PDF-` and contain a terminal `%%EOF` marker within its
last 1,024 bytes, followed only by permitted PDF whitespace. These are bounded envelope checks,
not full PDF validation and not receipt parsing. A `200` HTML response, including a provider shell
for an invalid selector, fails closed as `content_type_rejected` before body interpretation.
Malformed PDF-shaped bodies fail as `pdf_envelope_rejected`.

The internal transport body exists only long enough to check that envelope and calculate a SHA-256
digest. The public success returns a frozen descriptor containing only envelope version, fixed
media type, byte length, and digest. It never returns the PDF bytes, response headers, URL,
reference, receiver selector, resolved address, or exception. The narrower log projection omits
the digest and byte length as well as all protected request and response material. Failures expose
only fixed reason and failure classes.

A privacy-controlled provider observation established that the current successful envelope is a
PDF rather than the HTML shape assumed by the older synthetic fixture. It does not attest an exact
field-extraction contract. No live response, real receipt identifier, name, phone number, field
value, or provider document is stored in this package or its tests.

## Test and runtime isolation

All tests use clearly marked synthetic references, 12-digit synthetic selectors, byte envelopes,
DNS answers, streams, and errors. The lower-level DNS/HTTPS seam is available only by a relative
module import in package tests; it is not re-exported by the package entry point. No test contacts
CBE or any other network destination.

No application manifest or source imports the package. The package has no dependency on a PDF
parser, shared financial contracts, domain logic, runtime configuration, Supabase, PostgreSQL,
filesystem access, settlement, KemerBet, Telegram, customer web, or deployment code. Its only
dependency is the pure official-source policy.

## Remaining blockers and next boundary

The existing `official_receipt_live_response_contract_unattested` blocker remains because this
slice deliberately makes no claim about PDF field layout, labels, values, signatures, encryption,
or semantic meaning. The prerequisite inventory's `official_receipt_live_transport_absent`
capability also remains true for the authoritative lookup runtime: no permitted runtime composes
this package, no protected lookup material can reach it, and no operational source authorization
or trusted incident stop is wired.

The next provider-response boundary is a separately reviewed, exact PDF parsing package or library
built from privacy-controlled attestation. It must define fail-closed field extraction and drift
handling without widening this transport's public body surface. Later runtime composition must
also resolve source permission and request/rate policy, redacted operational telemetry,
receiver-material protection, worker decryption, normalization ownership, prelease-safe protected
material access, duplicate reads, evidence and claim handling, settlement, and rollout. None of
those capabilities is implied by an opaque PDF observation.
