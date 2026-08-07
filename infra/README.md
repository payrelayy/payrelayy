# Infrastructure contract

The production VM is intentionally not configured by this repository yet. When the services
are ready, deploy API, bot, worker, executor, and nginx with Docker Compose on the London VM.

Keep these rules in place:

- only SSH is open until HTTPS/TLS is ready;
- secrets are injected from the VM environment, never from Git;
- the executor has its own process, persistent browser profile, and restricted credentials;
- staging uses `FINANCIAL_ACTIONS_MODE=dry_run`;
- backups and monitoring are configured before production transactions are enabled.
