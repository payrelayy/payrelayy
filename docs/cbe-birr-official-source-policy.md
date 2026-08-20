# CBE Birr official-source policy

`@fetanagent/cbe-birr-official-source-policy` defines the reviewed offline shape for a future CBE
Birr official-receipt lookup. Contract version 2 has disposition `offline_profile_defined` and
reason `live_transport_absent`. It is not a live adapter and does not make a provider request.

## Compiled request profile

The route is fixed in source:

```text
GET https://cbepay1.cbe.com.et:443/aureceipt?TID=<REFERENCE>&PH=<RECEIVER_PHONE>
```

The compiled profile fixes all of the following:

- HTTPS, host `cbepay1.cbe.com.et`, explicit port `443`, and path `/aureceipt`;
- query parameters in the exact order `TID` then `PH`;
- transaction references as canonical uppercase 8--32 ASCII alphanumeric values;
- receiver lookup phones in the exact `251` plus nine decimal digits form; and
- redirect policy `reject_all`.

Runtime input cannot choose the method, scheme, host, port, path, parameter names, parameter order,
or redirect policy. The package contains no HTTP client, `fetch`, browser, environment lookup,
credential, cookie, authentication, filesystem, or dynamic loader.

## Offline synthetic parser

The package pins `parse5` exactly at `8.0.1`. Its static parser is exercised only with an exact
plain, non-proxy synthetic response data record containing clearly marked synthetic HTML. It
accepts no callback, transport, loader, request hook, or other caller-supplied executable code.
Accepted test inputs must use synthetic transaction references, receiver phones, and receiver
names; ordinary or real-looking inputs fail closed. The package does not fetch the compiled URL.

The offline parser proves these mechanics against deterministic synthetic fixtures:

- exact requested-reference comparison;
- exact configured receiver-name and receiver-account comparison;
- completed final status and `Send Money` transaction type;
- principal from the exact `Paid Amount` field, excluding service charge and VAT;
- integer ETB minor-unit conversion using `BigInt` internally;
- principal + service charge + VAT = total-debited arithmetic;
- explicit, calendar-validated Addis Ababa timestamps represented with `+03:00`; and
- fail-closed handling of missing/duplicate fields, malformed money, invalid dates, mismatches,
  unsupported status/type, oversized responses, and invalid synthetic response records.

Results never return a full transaction reference, receiver account, receiver name, HTML body, or
compiled URL. Successful synthetic results contain only masks, match booleans, allowlisted status
and type labels, integer money facts, fee arithmetic, and the explicit `+03:00` timestamp. Log
projections are narrower still: contract/parser versions, provider, disposition, and fixed reason
code only. Before projecting, the code revalidates exact result keys, disposition/reason pairings,
safe-fact invariants, masks, integer money and fee arithmetic, timestamps, and every disabled
capability. Errors never echo fixture or exception contents.

## Non-authority boundary

Both policy and parser types make every operational capability literal `false`, including:

- live transport and provider request;
- database access and persistence;
- runtime wiring;
- evidence or duplicate-payment claim; and
- any financial action.

The package has no API, Telegram, customer-web, worker, Supabase, SQL, migration, job, settlement,
KemerBet, deployment, or feature-switch integration. It cannot create authoritative evidence,
reserve a transaction, credit a Player ID, or move money.

The offline profile deliberately does not claim that the synthetic table labels match every real
official response. Before a live adapter can be considered, controlled privacy-reviewed samples
must attest the exact live response contract and parser behavior. A separately reviewed transport
must then enforce TLS, request/response/time bounds, zero redirects, outage behavior, telemetry
redaction, and an immediate stop. Those are two distinct remaining blockers:

- `official_receipt_live_response_contract_unattested`
- `official_receipt_live_transport_absent`

Completing offline mechanics is not evidence, settlement, or activation. Financial mode and both
KemerBet execution flags remain unchanged and disabled.
