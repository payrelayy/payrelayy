# Private repository and Owner Companion download

The production Owner page downloads the latest Windows Companion through the
Owner API. The API verifies an active Owner, reads the release with a separate
read-only GitHub credential, checks the ZIP against GitHub's SHA-256 digest, and
sends the file to the signed-in Owner. The browser never receives the GitHub
credential. This change does not create or retry a Player credit.

## Before the release

1. Keep the FetanAgent repository public until the new Owner download works.
2. In its owning GitHub account, create a fine-grained personal access token
   restricted to **only** the FetanAgent repository with **Contents: read-only**.
   Store it as the `OWNER_COMPANION_RELEASE_READ_TOKEN` secret in the GitHub
   `production` environment. Do not put the token in a URL, issue, command
   argument, repository file, or chat. Do not use the broad `gh` login token.
3. Check the account plan and configure an Actions spending budget before
   making the repository private. Preserve the existing `main` branch rules
   and required checks. Stop if the required private-repository features or
   the budget do not fit the Owner's monthly cap.
4. Require green PR checks and exact merged-main CI. Recheck the running
   release, deposit queue, unresolved attempts, payment switches, and helper
   digest immediately before production deployment.

## Deploy the Owner download while the repository is public

The reviewed production Droplet is `593344964`. This rotation expects the
currently running release `83a93f54f6684f4ca22bfdaa3c715a64a12a1d6d`,
the installed helper SHA-256
`25bacc11e4195c76e181b78cb800b69da286e42419aee64211f86e0484ff141a`,
and successor helper SHA-256
`6dc3971e612d63d8dc0b59a6d5dd9a3bf46e1ed23d012cca284ee51ad5f3cde5`.
These are stop guards; do not substitute a different production state.

1. Stage the exact merged-main helper Git blob as root-owned mode `0600` at
   `/root/fetanagent-production-v2-private-companion-download-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned mode `0700` directory. Stage the matching
   `fetanagent-production-v2-private-companion-download-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify digests and Bash syntax.
2. Run the rotation script with `inspect`; require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 PRIVATE COMPANION DOWNLOAD HELPER V1`.
   Inspect again; require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA
   with `mode=deploy-inert`, the observed unchanged financial profile, and
   the other exact live target inputs. Stop if a credit is active or uncertain.
4. Verify the new Owner page is healthy. Sign in as Owner, click **Download
   Windows Companion**, and compare the resulting ZIP with its checksum.
   Confirm the browser was not signed in to GitHub. Do not launch or install
   the downloaded ZIP merely to test this page.

## Change visibility

Only after the private download succeeds, change repository visibility to
private. Confirm `main` still has its required checks, Actions can read the
repository and publish a Companion release, and the Owner download still works
without a GitHub browser session. Confirm production services and payment
switches are unchanged. If the Owner download fails, restore visibility or
repair the server credential before relying on it for Companion recovery.

The older one-use protected operator-host workflow uses anonymous GitHub
release reads and is not the live deposit Companion path. It will not verify a
private release until that legacy workflow is separately updated or retired;
do not dispatch it after the privacy switch.
