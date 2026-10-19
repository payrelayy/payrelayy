# Production CBE Birr receiver child delivery

The future CBE receipt verifier is intended to run as an isolated container on the existing
DigitalOcean production host. It will parse bounded PDF bytes in memory. There is currently no
CBE verifier container, receiver-key mount, provider lookup loop, or CBE credit path in the
production Compose stack.

The manual `production-cbe-receiver-key-stage.yml` workflow is an earlier custody step. It
derives one revision-scoped receiver-opening child on an ephemeral protected GitHub runner,
compares the exact nonsecret pin digest from a successful key-plan run, and sends only the three
worker files over pinned-host SSH stdin to the dedicated root installer. The Owner master keys
stay on the runner. The installer checks the currently deployed release, the pin digest, file
contents, ownership, and modes, then seals the files under a one-use directory named for the
receiver revision and version. The child key is owned by UID 10001 with mode `0400`; the two
nonsecret profiles are root-owned with mode `0444`. The parent and revision directory are
root-owned `0700`. A different revision uses a different directory. No file is mounted or read by
any production app, and the workflow does not start or restart a service.

## Separate production decisions

1. Review and merge the workflow, installer, pinned sudoers grant, and synthetic tests. Merging
   changes no host or financial switch.
2. With separate host-change approval, install the exact reviewed helper at
   `/usr/local/sbin/fetanagent-cbe-receiver-key-installer` as root `0700` and its matching
   digest-pinned sudoers grant. Verify `visudo`, ownership, and the installed SHA-256. This does
   not stage a key or restart a service.
3. Confirm the actual deployed production release and active protected receiver revision. With
   separate approval, dispatch the workflow at exact passing `main` with those values and the
   successful key-plan digest. The workflow checks CBE verification is disabled immediately
   before derivation and after delivery. TeleBirr stays live; no payment is submitted or credited.

The host installer intentionally refuses to overwrite a revision directory. If an SSH timeout
or failed check leaves a partial private directory, inspect it under the host lock; do not retry
the same stage or delete it automatically. A later worker deployment must independently pin the
three files, recheck the active receiver revision at use, test the read-only bind mounts under UID
10001, and define retirement of old material. CBE verification remains disabled until the live
receipt contract, protected proof opening, prelease gate, global claim, settlement, and recovery
path are implemented and reviewed.

## Separate submitted-reference child

The `production-cbe-reference-key-plan.yml` and `production-cbe-reference-key-stage.yml` workflows
prepare a CBE-only child for opening v2 protected proof references. They use the existing deposit
proof producer masters on a protected runner, verify the approved v2 root profile, and derive only
the CBE child. The plan prints a digest of nonsecret pins; the stage sends the child and two profiles
over pinned SSH stdin to a separate digest-pinned host installer. The API masters are never sent to
the host installer or placed in its process environment. Staging requires CBE verification disabled
and an exact current deployed release. The host stores the child under a private one-use directory;
no running container mounts it. TeleBirr remains live.

Installing the reference-key helper and sudoers grant, running its key plan, and staging a real child
are separate production decisions. A partial directory after an uncertain SSH result requires
inspection under the host lock before any retry. Later worker deployment must pin the exact key ID
and profile digests, mount only this child under UID 10001, and define key rotation and retirement.
The staged key alone cannot lease a proof, contact CBE, claim a payment, or credit a Player.
