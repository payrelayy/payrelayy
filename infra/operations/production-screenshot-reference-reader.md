# Production screenshot reference reader

The Telegram bot extracts one 10- or 11-character transaction reference from a TeleBirr or CBE
Birr image using DigitalOcean Serverless Inference (`nemotron-3.5-super-vl`). The signed incoming
receiver-phone SMS remains the payment authority. This feature never treats an image as proof of
amount, recipient, or a completed payment. PDF extraction remains local.

The production Compose contract enables this reader and mounts one model access key only into the
bot. The guarded production workflow requires the GitHub Actions secret
`PRODUCTION_SCREENSHOT_MODEL_ACCESS_KEY`, validates its shape, transfers it with the sealed release,
and installs it as a mode-`0400` secret owned by the bot runtime. The release helper verifies the
secret and preserves compatibility with earlier releases that did not enable the reader. Do not put
the key in Git, workflow inputs, chat, logs, or a Compose environment value.

Before any production merge or deploy, review and install the updated checksum-pinned
`fetanagent-production-deploy-helper-v2.sh` and matching sudoers grant through a separately
authorized privileged helper rotation. The workflow checks the exact installed helper digest and
will refuse a deploy until it matches. Store a DigitalOcean key scoped to the single vision model
in the GitHub Actions secret. DigitalOcean currently displays **All routers** even for a key
created with **Select routers** and zero routers checked; do not assume router access is excluded.
Resolve or explicitly accept that scope before putting the key into production. Keep the
DigitalOcean spend alert in place without automatic pausing, as selected by the owner.

After the exact merged-main CI passes and current production financial/lease/job gates are
rechecked, use the guarded `Production application runtime` workflow in `deploy-inert` mode for the
receiver-SMS release. Do not make a real payment as a test. Monitor only masked outcomes, model
token counts and duration, bot health, and DigitalOcean charges. If extraction fails, ask the user
to type the reference; never credit from an image without the signed SMS match. Rollback uses the
previous release through the guarded helper if the new bot fails health checks.
