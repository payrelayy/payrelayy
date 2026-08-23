# Reviewed KemerBet selector contract

`kemerbet-selector-contract.v2.json` was reviewed on 2026-08-23 against the public KemerBet Agent
System v84 assets and the unauthenticated login DOM:

| Asset                                                                               | SHA-256                                                            |     Bytes |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------: |
| `https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/index-BUEO7OSf.js`  | `181b3319d58d557218402ee4051e16f40389697f5c520d993a8a77d2219953d2` | 6,278,073 |
| `https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v84/index-BnOqIDsD.css` | `db202373e92a8ffa5bdf5c9d4cc69ce9acc3e7df9574fc51c292c3ba3408d4bc` |   354,651 |

The review confirmed the exact visible Agent identity classes, financial-actions trigger, Deposit
menu item, To Player tile, Find By / Player ID form, Amount and Notes fields, Transfer control,
response-bound Player information layout, `GET /Player/GeneralInfoByExternalId`, and
`POST /Wallet/PlayerEPOSDeposit`. The login form and reCAPTCHA selectors were independently checked
against the rendered login page.

This file is a fail-closed observation contract, not financial authority. Any asset, locale, route,
cardinality, or DOM drift must make the readiness/executor browser unavailable until a new contract
is reviewed. Never add fallback body-text selectors or copy account, Player, credential, cookie, or
balance data into this directory.
