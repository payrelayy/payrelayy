# CBE Birr offline normalization candidate

`@fetanagent/cbe-birr-normalization-candidate` is a small, pure, synthetic-data-only proposal for
the three value formats needed by a future official receipt lookup. It has no application or worker
consumer, transport, secret, database access, or financial action.

| Boundary                                            | Candidate rule                                                       | Important exclusion                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Customer-submitted reference                        | Exactly 8–32 ASCII letters/digits; ASCII lowercase maps to uppercase | No trim, punctuation removal, Unicode conversion, or legacy 5–128-character upgrade   |
| Canonical reference from an independent observation | Already uppercase ASCII letters/digits, 8–32 characters              | A format match is not proof that the provider issued it                               |
| Configured receiver phone                           | Exactly `251` plus nine ASCII digits                                 | No inference from a 9-digit Owner value                                               |
| Official receipt `PH` selector                      | Last nine digits of that validated full receiver phone               | `PH` is not receiver evidence; the PDF credit account needs an independent comparison |

The candidate alone does not update the normalization-ownership inventory or clear an
authoritative-lookup blocker. Separate offline cross-package reviews establish the local
provider-aware v2 proof-to-unwired-transport `TID` relationship and the newly protected v2 receiver
revision-to-`PH` relationship. These reviews do not prove revision or key provenance, that the PDF
credited the configured receiver, receipt parsing, provider acceptance, or settlement.
It must not be imported into the bot, API, Companion, or verifier as an authorization decision.
No live CBE Birr reference, account, receipt, or other personal data is stored here.

The Owner receiver form and API independently reject newly submitted CBE Birr receiver phones
that are not full `251` plus nine-digit values. That storage-boundary check follows the Owner's
confirmed receiver format; it is not a runtime use of this offline candidate and does not prove
that the `PH` selector identifies the credited account on a particular PDF. Existing revisions
remain unchanged and require separate review before CBE Birr can be enabled.
