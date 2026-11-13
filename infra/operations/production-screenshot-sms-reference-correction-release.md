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
2. Deploy that application commit first. The two receiver SMS production
   overlays enable the bot correction. Before the database migration, the new
   API returns no correction for an absent function or grant, so image
   submissions continue through the original path.
3. After every old API instance has stopped, review the production migration
   dry run for any other pending changes, then apply the reviewed set. These
   two migrations must run in order:
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

The probe adds one private lookup for ambiguous image references. It skips
local OCR when there is no eligible SMS, uses no retry, and has a 1.5-second
network limit. Typed references, PDFs, captions, and images without these
glyphs retain their existing timing. A payment SMS that has not yet reached
the server cannot support a correction at submission time; the original
reference is preserved in that case.
