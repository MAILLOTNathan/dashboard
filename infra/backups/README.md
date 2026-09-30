# Backups

Scripts and procedures only. **Never commit an actual backup**: a dump contains
personal financial data.

- `backup.sh` — logical `pg_dump` (custom format) written to this directory on the host.
- `restore.sh` — restores a dump into a target database, recreating it first.

## Procedure

```sh
./infra/backups/backup.sh
./infra/backups/restore.sh infra/backups/dashboard-<timestamp>.dump dashboard_restore_test
```

## To plan before production

- Encrypt backups at rest and store them outside the host (object storage, second disk).
- Schedule `backup.sh` (cron or systemd timer) and alert on failure.
- Run a restore test on a regular schedule, not only once: an untested backup is not a backup.
- Keep a retention policy (for example 7 daily, 4 weekly, 12 monthly) and document it.
- Backups live on the same disk as the database today: this is a development
  convenience, not a production strategy.
