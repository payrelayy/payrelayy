# Screenshot reference correction release

This change affects only image receipts without captions. The bot keeps the
existing customer messages and deposit flow. For a reference containing `0/O`
or `5/S`, it asks the private API whether exactly one recent, unused, signed
receiver SMS has a matching alternative reference. It changes the reading only
if local OCR of the same image independently reads that alternative. All other
submissions keep the original reading. The optional probe never credits money
or writes a payment candidate.

## Production order

1. Review the exact main commit and pass its application and SQL integration
   checks. Keep the existing payment switches and Companion settings unchanged.
   The guarded release must first refresh its exact predecessor to the currently
   running `babb5169935e420d1b191420b604210423cb729d` release using the
   [checksum-pinned screenshot SMS guard helper rotation](production-v2-screenshot-sms-guard-rotation-v1.md). Its inspect and rotate
   steps must confirm that no running container or payment setting changed.
2. Deploy that application commit first. The two receiver SMS production
   overlays enable the bot correction. Before the database migration, the new
   API returns no correction for an absent function or grant, so image
   submissions continue through the original path.
3. After every old API instance has stopped, compare the hosted migration
   ledger with the repository and review the production migration dry run. The
   hosted 2026-11-12 operational entries have comment-only markers; the
   replay-safe `20261112134500` Owner list optimization is also pending locally
   and must return without changes on the already-correct production function.
   Then these two screenshot migrations must run in order:
   `20261113223425_receiver_sms_screenshot_reference_probe.sql` creates the
   ungranted function, then
   `20261113223625_receiver_sms_screenshot_reference_probe_activate.sql`
   grants only the player-action database role access. Do not grant the
   function while an old API instance is running: its exact grant catalog
   would fail its health preflight.
4. Verify the new API and bot health, the read-only function grant, and the
   unchanged financial switches. Check that the SQL integration and bot tests
   prove the one-SMS and independent-OCR conditions. Do not create a live
   deposit as a smoke test.

## 2026-11-13 production handoff

The screenshot probe creation and activation migrations reached production
before the application cutover. The activation grant made the old API's exact
function-surface preflight fail, so its `/readyz` returned HTTP 503. The
`20261113233217` operational migration revoked only that optional probe grant;
the old API returned HTTP 200. The checksum-pinned helper rotation and guarded
application deployment then completed at main commit
`d2d3064395b205e8cf3792f3167e0924f839d68c` with the payment switches
unchanged. After the new API was healthy, `20261113233924` restored the grant.
Both migrations are recorded here to keep fresh database replay and the hosted
ledger aligned. The correction path is enabled; no live payment was created to
test it.

The probe adds one private lookup for ambiguous image references. It skips
local OCR when there is no eligible SMS, uses no retry, and has a 1.5-second
network limit. Typed references, PDFs, captions, and images without these
glyphs retain their existing timing. A payment SMS that has not yet reached
the server cannot support a correction at submission time; the original
reference is preserved in that case.
