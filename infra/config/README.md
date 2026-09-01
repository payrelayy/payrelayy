# Reviewed KemerBet selector contract

`kemerbet-selector-contract.v2.json` was rechecked on 2026-09-01 against the public KemerBet Agent
System v85 assets and the unauthenticated login DOM:

| Asset                                                                               | SHA-256                                                            |     Bytes |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------: |
| `https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-Bb0iEF9d.js`  | `06c94f719e4d048dbb9d6098ed585083ffdf5c0684d08ea08be096a061a9252e` | 6,303,397 |
| `https://agt-client-akm.agent-digi.com/prd/agt-admin-client/v85/index-CzsfyLxR.css` | `a104969e211a822a390a66fc1a42afaee4d131e58b65980e495957c275b4816b` |   357,774 |

The review confirmed the exact visible Agent identity classes, financial-actions trigger, Deposit
menu item, To Player tile, Find By / Player ID form, Amount and Notes fields, Transfer control,
response-bound Player information layout, `GET /Player/GeneralInfoByExternalId`, and
`POST /Wallet/PlayerEPOSDeposit`. The login form and reCAPTCHA selectors were independently checked
against the rendered login page. The v85 recheck confirmed one canonical username input, one
canonical password input, one exact Sign In control, and the unchanged fail-closed login-form
selector; no credential or provider login request was used during this public-DOM review.

This file is a fail-closed observation contract, not financial authority. Any asset, locale, route,
cardinality, or DOM drift must make the readiness/executor browser unavailable until a new contract
is reviewed. Never add fallback body-text selectors or copy account, Player, credential, cookie, or
balance data into this directory.
