# Receiver SMS Owner queue release

This release shows the signed phone outbox count in Owner and removes unsent phone records after five hours. It makes no payment and does not change payment limits.

| Guard                              | Exact value                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Production Droplet                 | `593344964`                                                                                |
| Running release and routine marker | `6c7bf1b1445d17e7279dc5c51086a5fd0df62f1a`                                                 |
| Installed helper SHA-256           | `f50db8285c9e60c8d14ec6158356ff3a3a52879f267b3da3da1d1dfce1ad4b60`                         |
| Successor helper SHA-256           | `494ee66460c232969359fc7ba652b67fd589a0851ecb2feb8ea85b6fdf01594b`                         |
| Helper rotation                    | `infra/operations/fetanagent-production-v2-receiver-sms-owner-queue-helper-rotation-v1.sh` |
| Database hold migration            | `20261106195223_receiver_sms_queue_grant_hold.sql`                                         |

1. Require passing PR and exact-main CI. Confirm current release, routine marker, helper and sudoers digest, healthy broker and phone bridge, and no unfinished credit before deployment.
2. Stage the exact merged-main helper Git blob as root-owned mode `0600` at `/root/fetanagent-production-v2-receiver-sms-owner-queue-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`. Stage the rotation script separately as root-owned mode `0700`. Verify digests and Bash syntax. Run `inspect`, then `rotate 'ROTATE EXACT PRODUCTION V2 RECEIVER SMS OWNER QUEUE HELPER V1'`, then `inspect` again. Confirm no production runtime changed.
3. Deploy the new server with the normal guarded `deploy-inert`, `cbe-live-v1`, routine-enabled, pooler workflow. Keep the new count function ungranted. The replacement broker uses the old status function for the current phone.
4. After the replacement broker and Owner are healthy, grant only `app.record_receiver_sms_device_status_with_queue(text,text,text,timestamptz,text,text,integer)` to `fetanagent_receiver_sms_ingest`. Verify the exact function surface and broker health again.
5. Install the attested v0.5.45 phone APK in place. Verify a fresh signed heartbeat and the Owner queue count. Check the active and unresolved credit queue without making a payment.

If server deployment fails, the database grant stays revoked and the old phone/server path remains usable. If the phone update fails, the new server continues accepting old signed status reports, and Owner displays an unknown queue count until the updated phone reports.
