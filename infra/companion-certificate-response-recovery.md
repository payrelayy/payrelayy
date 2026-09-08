# Recover a completed companion pairing response

The Windows client must assess a returned enrollment certificate after reading the response.
A timestamp captured before the request will reject an otherwise valid certificate created
by the server while the request was in flight. Version 0.1.9 corrects that timing without
adding clock-skew tolerance or weakening signature, device-binding, expiry, or no-money checks.

If Supabase already contains the completed, signed certificate but the local enrollment file
is missing, do not generate a new device key or another pairing package. Retain the existing
Windows-protected key and recover the response:

1. Through an authenticated administrative read, locate the exact already-issued certificate.
   Require an active Owner issuance, the intended production signer, current validity, and no
   device or signer revocation. Do not mutate the database or issue another certificate.
2. Independently verify the intended server key ID and public-key SHA-256 against protected
   production configuration. These trust pins must not come only from the recovery payload.
3. Build the reviewed Windows companion source. Pass only the public stored-enrollment JSON
   on stdin to `scripts/restore-windows-companion-enrollment.mjs`, with the exact existing data
   root, trusted server key ID, and trusted public-key SHA-256 as its three arguments.
4. The recovery operation verifies the server signature, all certificate constraints, current
   validity, and the exact existing DPAPI-protected device key. It creates only the missing
   public enrollment file, refuses overwrite, and never generates or exports a private key.
5. Restart the companion normally after the local Owner closes its separate Chrome window.
   Verify the cached certificate and an authenticated production poll. No new package is needed.

Never put private keys, passwords, pairing packages, or browser data in the recovery input.
Recovery does not authorize lookup or financial commands. Revocation checks remain required on
the server for every authenticated request after restart.
