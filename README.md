# Dashboard

Personal steering companion: GitHub/GitLab project activity, real-estate assets
and a personal budget, in a single Next.js application.

Interface in French, code and comments in English. See `AGENTS.md` for the
project intentions and `docs/architecture/overview.md` for the design.

## Status

This is a **base project**: the foundations are in place and verified, and the
first functional slice (data entry, budget view, real-estate view, CSV export,
provider adapters) is implemented.

Working today:

- Owner authentication (Auth.js credentials, no public sign-up).
- Personal budget: accounts, categories, transactions entered from the budget
  page, monthly totals per currency, filters, CSV export, deletion with confirmation,
  and two charts (a 12-month trend and the month's spending per category).
- Real estate: properties and cashflow entries entered from the real-estate
  page, occupancy status, totals, due dates.
- GitHub / GitLab connections: read-only adapters, encrypted tokens, manual
  synchronisation, project snapshots, plus the open GitHub issues and pull requests
  counted per repository, with the new, unanswered and long-standing ones flagged.
- Dashboard with indicators derived from real data, distinguishing "no data",
  "not connected" and "synchronisation failed".

Not implemented yet:

- Editing an existing row: a row can be created or deleted, not modified in place
  (delete it and enter it again). The budget view is a table, not an editable grid.
- Accounts, categories and properties cannot be deleted yet; only transactions can.
- A scheduler entry point for automatic synchronisation (the function exists and
  is idempotent; the trigger is not shipped).
- Bank connection, payments, accounting, tax advice — permanently out of scope.
- Document storage.

## Prerequisites

- Node.js 22 or later
- Docker, for the local PostgreSQL

## Quick start

```sh
# 1. Install dependencies (also generates the Prisma client)
npm install
npm run db:generate

# 2. Local configuration
cp .env.example .env
#    then fill AUTH_SECRET and INTEGRATION_ENCRYPTION_KEY:
#    openssl rand -base64 32

# 3. Start PostgreSQL and prepare the database
docker compose up -d --wait db
npm run db:migrate
npm run db:seed          # creates the owner from SEED_OWNER_* variables

# 4. Run
npm run dev              # http://localhost:3000
```

Ports 3000 and 5432 may already be used by another local project. Use
`PORT=3100 npm run dev`, and set `POSTGRES_PORT` in `.env` (keeping
`DATABASE_URL` consistent) when 5432 is taken.

### Full stack in containers

```sh
docker compose --profile full up -d --build
```

The `migrate` service applies pending migrations, then the `seed` service creates
or updates the owner account from `SEED_OWNER_*`. Both exit; `app` starts only
once they succeeded, so a failed migration or a missing account never boots a
server. Inspect them with `docker compose --profile full logs migrate seed`.

The seed is idempotent and runs on every `up`: `.env` is the source of truth for
the owner password. Change `SEED_OWNER_PASSWORD` and run `up -d` again to rotate
it, or run that step alone with `docker compose --profile full run --rm seed`.

Without a profile, `docker compose up -d` starts PostgreSQL only.

The Prisma CLI stays out of the application image: it is a dev dependency
weighing about 210 MB with its engines, and it is not traced into the standalone
server output. Migrations and the seed run from the dedicated `db-tools` stage
(see `Dockerfile`), which also has the `tsx` runner and the source modules the
seed imports.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Unit tests (Vitest) |
| `npm run db:generate` | Generate the Prisma client into `src/generated/prisma` |
| `npm run db:migrate` | Create and apply a migration (development) |
| `npm run db:deploy` | Apply pending migrations (deployment) |
| `npm run db:seed` | Create or update the owner account |
| `npm run db:studio` | Browse the database |

## Project structure

```text
src/
  app/                 # pages, layouts, Route Handlers, Server Actions
  components/          # interface components
  modules/             # business rules, per module
    identity/ budget/ real-estate/ integrations/ dashboard/
  lib/                 # database, configuration, cross-cutting utilities
  jobs/                # synchronisation tasks run server-side
  generated/prisma/    # generated client, not committed
prisma/                # schema, migrations, seed
infra/backups/         # backup and restore scripts
docs/                  # architecture and decisions
compose.yaml
```

## Conventions worth knowing

- Money uses exact decimals, never floats. Negative amounts are outflows.
- Monthly balance **excludes transfers between accounts**; their volume is shown
  separately. Every indicator definition is documented in
  `docs/architecture/overview.md`.
- Operation dates are calendar days; instants are stored in UTC.
- Secrets stay server-side. `.env` is git-ignored; only `.env.example` is
  versioned, with fictitious values.
- Provider tokens are encrypted with AES-256-GCM before being stored.
- Amounts are typed with a sign: a rent is `900,00`, a charge is `-45,90`. A
  positive amount on an expense is a reimbursement. The amount is read in the
  currency of its account, which is never asked for twice.
- A property cashflow is either a typed amount **or** a link to a transaction,
  never both: otherwise the same money would be counted twice.
- The write forms validate in the browser with zod (react-hook-form) and the
  Server Action validates the same payload again before touching the database.

## Synchronisation

One run can be triggered from the integrations page. Automatic scheduling is not
wired yet: the repository deliberately ships no cron unit or platform job, only
the idempotent functions in `src/jobs/sync.ts` that such a trigger should call.

A run is idempotent: replaying it updates snapshots instead of duplicating them.
Nothing is written when a run fails halfway, and the previous successful
synchronisation is kept for display.

## Before production

- Configure HTTPS through a reverse proxy; keep PostgreSQL off the public
  network.
- Provide real secrets through the environment, never through an image layer.
- Schedule `infra/backups/backup.sh`, store backups encrypted off the host, and
  run `infra/backups/restore.sh` as a restore test. See `infra/backups/README.md`.
- Apply migrations and create the owner before the application starts: the
  `migrate` and `seed` services do both, or run them alone with
  `docker compose --profile full run --rm migrate` / `run --rm seed`.
- `SEED_OWNER_PASSWORD` is authoritative: the seed rewrites the stored hash on
  every `up`. Keep it out of the image and rotate it by editing `.env`.
