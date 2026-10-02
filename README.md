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

- Owner authentication (Auth.js credentials, no public sign-up), with a **Compte**
  page to change the owner password.
- Personal budget: accounts, categories, transactions entered from the budget
  page, monthly totals per currency, filters, CSV export, deletion with confirmation,
  correction of an existing operation (the row reopens in the entry form, filters kept)
  and two charts (a 12-month trend and the month's spending per category). Submitted
  values stay in the transaction and cashflow forms, so a second line is a small edit;
  the one-shot forms (account, category, property, password) clear themselves.
- Real estate: properties and cashflow entries entered from the real-estate
  page, occupancy status, totals, due dates.
- GitHub / GitLab connections: read-only adapters, encrypted tokens, manual
  synchronisation, project snapshots, and a small GitHub: open issues and pull
  requests counted per repository, an explorer with combinable filters (repository,
  type, assignee, label, milestone, state, text), and milestones with their due dates
  and progress. GitLab stays on project metadata, on purpose.
- Dashboard with indicators derived from real data, distinguishing "no data",
  "not connected" and "synchronisation failed".

Not implemented yet:

- The budget view is a table, not an editable grid: correcting a line means reopening it
  in the entry form, not typing in the cell. Only transactions can be edited — accounts,
  categories and properties can still only be created, never modified.
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

Ports 8888 (proxy), 3000 (application) and 5432 may already be used by another local
project. Use `PORT=3100 npm run dev`, set `PROXY_PORT` for the proxy (see
[The proxy and the address you browse](#the-proxy-and-the-address-you-browse)), and set
`POSTGRES_PORT` in `.env` (keeping `DATABASE_URL` consistent) when 5432 is taken.

### Full stack in containers

```sh
docker compose --profile full up -d --build
```

The `migrate` service applies pending migrations, then the `seed` service creates
the owner account from `SEED_OWNER_*`, or refreshes the name of the one that exists.
Both exit; `app` starts only once they succeeded, so a failed migration or a missing
account never boots a server. Inspect them with
`docker compose --profile full logs migrate seed`.

The seed is idempotent and runs on every `up`. It writes `SEED_OWNER_PASSWORD` when
it creates the account, then leaves the stored hash alone: a password changed from
the **Compte** page survives a restart. To put the environment value back in force —
which is also how a forgotten password is replaced — set
`SEED_OWNER_FORCE_PASSWORD=true` and run `up -d` again, or run that step alone with
`docker compose --profile full run --rm seed`. The seed prints which of the two it
did.

Without a profile, `docker compose up -d` starts PostgreSQL only.

The Prisma CLI stays out of the application image: it is a dev dependency
weighing about 210 MB with its engines, and it is not traced into the standalone
server output. Migrations and the seed run from the dedicated `db-tools` stage
(see `Dockerfile`), which also has the `tsx` runner and the source modules the
seed imports.

### Changing the password

The **Compte** page (`/account`) shows the owner's address and name, and changes the
password. Three rules are enforced on the server, not in the interface:

- The current password is required and verified with bcrypt before anything is
  written, so an open session alone cannot lock the owner out of their own data.
- The new password must be at least 12 characters, and at most 72 bytes: bcrypt reads
  no more than 72 bytes, so a longer one would quietly open the same account as its
  own first 72 bytes. An accented letter counts for two bytes.
- A successful change signs **every** session out, this one included. Session tokens
  carry a fingerprint of the password hash they were issued for, and `getSessionUser`
  compares it with the stored row, so a change made on one device also disconnects the
  others. Tokens issued before this check existed are refused once and require one
  sign-in.

Because the password then differs from `SEED_OWNER_PASSWORD`, the seed no longer
overwrites an existing hash — see the note above. A forgotten password is replaced
from the server, with `SEED_OWNER_FORCE_PASSWORD=true`; there is no self-service
recovery, on purpose.

### The proxy and the address you browse

The `full` stack puts a small reverse proxy in front of the application: it is the
front door, and the address to type is `http://dashboard.localhost:8888`:

```sh
# AUTH_URL, APP_HOST and PROXY_PORT already describe that origin in .env
docker compose --profile full up -d --build
```

Three variables describe that single origin, and they are not independent. A mismatch
is invisible in `docker compose ps`: it only shows up in the browser.

- `PROXY_PORT` is the port published on the host, 8888 by default.
- `APP_HOST` is the site address the proxy answers for. It carries the same port,
  because Caddy listens on the port of its site address.
- `AUTH_URL` is the origin the application is told to use for absolute URLs, the
  sign-in callback in particular.

The application's own port (3000) stays published on loopback for debugging: it serves
the same process, but not the origin Auth.js was told about. It is also a different
host (`localhost`, not `dashboard.localhost`), so it is a separate session: useful for
`curl`, not for signing in.

`APP_HOST` also decides the scheme. `http://dashboard.localhost:8888` serves plain
HTTP, which is what you want locally: there is no certificate to install. A bare
hostname (`APP_HOST=dashboard.example.com`) makes the same file serve HTTPS with an
automatically obtained certificate, which is what you want on a server — set
`PROXY_PORT=80` (or `443`) there, so the URL needs no port.

The default needs no hosts entry: `.localhost` and its subdomains are reserved for
loopback (RFC 6761), and current browsers and `curl` resolve them to this machine on
their own. Any other name does need one:

```sh
echo "127.0.0.1 budget.etib.test" | sudo tee -a /etc/hosts
# then set APP_HOST=http://budget.etib.test:8888 and AUTH_URL=http://budget.etib.test:8888
```

Two failure modes are worth recognising, because neither looks like an error:

- A name the proxy was not configured for gets an **empty page**, not a 404. A blank
  tab normally means the address you typed and `APP_HOST` differ: typing
  `localhost:8888` against an `APP_HOST` of `dashboard.localhost:8888` is exactly this,
  because the two are different hosts, not two spellings of one.
- A mismatched `AUTH_URL` signs you in on a different origin than the one you typed,
  because the session cookie belongs to a single host.

Three reasons to go through the proxy rather than publishing the application directly:

- **Auth.js needs to be told its public origin.** The standalone server otherwise
  derives absolute URLs from its own container identity and internal port
  (`http://<container-id>:3000`), which no browser can reach: the sign-in callback
  would point there. `AUTH_URL` is what makes that origin explicit.
- **Cookies are per host**, so a session opened on one host is not shared with another.
  Pick one origin and stay on it: `AUTH_URL` and the address you type must match, or you
  will be signed in on one and unknown on the other. Cookies ignore the port, so
  `dashboard.localhost` and `dashboard.localhost:8888` would share a session: changing
  the port alone never signs you out, changing the host does.
- The proxy also keeps `Host` and `Origin` aligned, which is what the Server Actions
  check before accepting a form submission.

Why these names: `.localhost` (RFC 6761) and `.test` (RFC 2606) are both reserved and
can never resolve publicly — unlike `.local`, which is mDNS territory, or an invented
name that could exist one day. `.localhost` has the advantage of needing no
configuration at all, which is why it is the name documented for the hostname
alternative.

The proxy belongs to the `full` profile, so it starts and stops with the application:

```sh
docker compose --profile full logs proxy
docker compose --profile full ps
docker compose --profile full down
```

It used to live in a profile of its own, which meant a forgotten flag left the front
door refusing connections while `app` and `db` looked healthy — the proxy depends on
`app`, so the two belong together. `docker compose up -d` with no profile still starts
PostgreSQL only.

Publishing 8888 is now part of the full stack. Set `PROXY_PORT` if something else
already holds it.

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
- A transfer counts as a real movement: the monthly balance **includes** it, on the side its
  sign puts it (negative → expenses, positive → income), and its volume is shown separately
  as a subset. Every indicator definition is documented in
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
