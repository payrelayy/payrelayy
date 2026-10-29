# Owner health alerts — production release guard refresh

The Owner alert SQL migration was applied before the application deployment.
The first deployment attempt for `c7101535050bb78b368bfca9a46244ed0baa8569`
stopped at its predecessor status check, before activation. Production remains on
`0c354ea06ff48c98122181c703467b442b52c1ca` with its routine-deposit marker.

The current protected helper SHA-256 is
`37bfde8ed339a6ca911342458d0e954122d1e62fcc528b31b8b8fb2460575108`.
The reviewed successor helper SHA-256 is
`306708f9fd01370b625112742d15bab503098db9749d21b2a41cf9117bb0d730`.

1. Require green CI on the exact merged main commit. Verify Droplet `593344964`,
   the current release and routine-deposit marker above, the installed helper and
   sudoers digest, live financial-switch profile, and no unresolved Transfer.
2. Stage the exact merged-main helper Git blob as root-owned mode `0600` at
   `/root/fetanagent-production-v2-owner-health-release-guard-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned `0700` directory. Stage
   `fetanagent-production-v2-owner-health-release-guard-helper-rotation-v1.sh`
   separately as root-owned mode `0700`. Verify their SHA-256 digests and Bash
   syntax. Run `inspect`, then `rotate` with
   `ROTATE EXACT PRODUCTION V2 OWNER HEALTH RELEASE GUARD HELPER V1`. Require
   `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the same passing main commit with
   `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, routine transport `enabled`, database route `pooler`, financial
   profile `cbe-live-v1`, and operation phrase
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Both TeleBirr pilot inputs are
   `not-applicable`. Stop if any preflight differs; do not change a payment
   switch to make the deployment pass.
4. Verify the exact new release SHA, healthy bot and Owner service, unchanged
   payment switches and routine transport, and the alert panel on Owner Home.
