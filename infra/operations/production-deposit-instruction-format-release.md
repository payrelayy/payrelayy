# Telegram deposit instruction formatting — guarded production release

The new Deposit card emphasizes the amount, method names, and saved Player ID while
keeping both receiver numbers copyable. It asks the customer to use one method.
Replies to previously issued cards remain recognized. This release changes bot
wording and Telegram entities only; it does not change payment verification,
credit execution, receiving accounts, or payment switches. Do not submit or retry
a real payment to test the wording.

| Boundary                                    | Exact value                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Production Droplet                          | `593344964`                                                                           |
| Required running release and routine marker | `830f233f5acb24674fc93c2dd6ad7d93a54ffc15`                                            |
| Installed helper SHA-256                    | `24dbb0be96253a173906da6e99bfc3242444286d2c3cd337ec1bf88cd018b218`                    |
| Successor helper SHA-256                    | `7227d02fc9eee8e5ce4189e955ea32a2971ff76b3d330602e5536c9ef908bc19`                    |
| Rotation script                             | `infra/operations/fetanagent-production-v2-deposit-instruction-helper-rotation-v1.sh` |

1. Require green PR checks and exact merged-main CI. Recheck the active release,
   routine marker, helper digest, health, payment-switch profile, and unresolved
   credit work. Stop if the predecessor or payment state differs.
2. Stage the exact merged-main helper Git blob as
   `/root/fetanagent-production-v2-deposit-instruction-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned mode-`0700` directory, with file mode `0600`. Stage the
   exact merged-main rotation script separately as root-owned mode `0700`.
   Verify both SHA-256 digests and Bash syntax.
3. Run the rotation script with `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 DEPOSIT INSTRUCTION HELPER V1`, then inspect
   again and require `successor-exact; rotation complete; no production runtime changed`.
4. Dispatch `.github/workflows/production-runtime.yml` from the exact passing
   main SHA with `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`,
   Droplet `593344964`, both TeleBirr pilot inputs `not-applicable`, routine
   transport `enabled`, database route `pooler`, and the observed payment-switch
   profile. For `cbe-live-v1` use
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`; for
   `cbe-stopped-v1` use `confirm_operation=DEPLOY CBE STOPPED PHONE PROOF`.
   Require the workflow's idle cutover, switch fingerprint, and health checks.
5. Verify the running release and unchanged payment switches. Request one fresh
   Deposit card without paying. Confirm its formatted headings, copyable
   receiver numbers and Player ID, one-method wording, and unchanged Amharic
   copy hint. Do not change a payment switch or receiver to satisfy a guard.
