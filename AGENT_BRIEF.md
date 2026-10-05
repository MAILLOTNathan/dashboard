# Agent brief — dashboard

Factual snapshot of this repository for a coding agent starting with no context.
`AGENTS.md` holds the mission and the working principles (intent); this file says
what actually exists, how it is verified and where the traps are. Snapshot:
2026-10-05.

## What it is

A single-owner personal steering dashboard: personal budget, real-estate assets,
GitHub/GitLab project activity and a home dashboard. Interface in French, code and
comments in English. No public sign-up, no multi-tenancy. Provider access is
read-only; personal and company data are not mixed.

## Stack

- Next.js 16.3.7 (App Router, Turbopack, `src/` directory), React 19.2.8, TypeScript 5
- Tailwind CSS 4, ESLint 9 (flat config)
- Prisma 7.10 with the `@prisma/adapter-pg` driver adapter, PostgreSQL 17
- Auth.js v5 beta: credentials provider, bcryptjs, JWT sessions
- zod 4, decimal.js, react-hook-form + @hookform/resolvers
- Vitest 5; npm; Docker Compose; GitHub Actions (`.github/workflows/ci.yml`)
- Node.js 22 or later

## Layout

```text
src/
  app/(app)/         authenticated pages: account, budget, dashboard, integrations, real-estate
  app/api/           Route Handlers: auth callbacks + CSV export (401 JSON, never a redirect)
  app/login/         sign-in page
  components/        shared UI (forms, server-rendered SVG charts, navigation)
  modules/           business rules per module: identity, budget, real-estate,
                     integrations, dashboard (domain.ts / repository.ts inside each)
  lib/               db, env, money, dates, csv, crypto, auth helpers
  jobs/sync.ts       idempotent synchronisation functions (no scheduler shipped)
  generated/prisma/  generated client — git-ignored; run `npm run db:generate`
prisma/              schema, migrations, seed
infra/               backup / restore scripts, Caddyfile for the proxy
docs/                architecture/overview.md, decisions/
```

## Data model (`prisma/schema.prisma`)

`User` (sole owner) owns `Account`, `Category`, `Transaction`, `Property`,
`IntegrationConnection`. Key rules:

- `Transaction.amount` is `Decimal(18, 2)`, signed (negative = outflow); never floats.
- `Transaction.operationDate` is `DATE`; instants are `timestamptz(3)` UTC.
- `PropertyCashflow` carries **either** a typed `amount` **or** a `transactionId`
  (mutually exclusive, link unique): no double counting in property totals.
- `IntegrationConnection.credentialsCiphertext` holds the AES-256-GCM token; it is
  never returned to the browser.
- `ProjectSnapshot` / `IssueSnapshot` / `MilestoneSnapshot` are keyed by
  `(connectionId, externalId)` — that is what makes a sync re-runnable.

## Commands

| Command | Notes |
| --- | --- |
| `npm install` | Dependencies are not committed. |
| `npm run db:generate` | Generates the Prisma client into `src/generated/prisma`; required before typecheck, tests and build. |
| `npm run dev` | Development server. If host port 3000 is taken: `env PORT=3100 npm run dev`. |
| `npm run lint` | ESLint 9. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Vitest, one run (`npm run test:watch` to keep it running). No database, no network: adapters get an injected fake `fetch`. |
| `npm run build` | Production build. It type-checks test files too. |
| `npm run db:migrate` / `npm run db:deploy` | Create + apply a migration (dev) / apply pending migrations (deploy, CI). |
| `npm run db:seed` | Creates the single owner from `SEED_OWNER_*`; idempotent. |
| `npm run db:studio` | Prisma Studio. |

Local flow: `npm install`, `npm run db:generate`, copy `.env.example` to `.env`,
`docker compose up -d --wait db`, `npm run db:migrate`, `npm run db:seed`,
`npm run dev`.

Full stack: `docker compose --profile full up -d --build` →
http://dashboard.localhost:8888 (the proxy belongs to the `full` profile).

## Environment

- Copy `.env.example` to `.env`; it documents every variable.
- Required server-side: `DATABASE_URL`, `AUTH_SECRET` (32+ characters),
  `INTEGRATION_ENCRYPTION_KEY` (32 bytes, base64, protects provider tokens),
  `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- The browsed origin is three coupled variables that must agree: `AUTH_URL` (what
  the app is told), `APP_HOST` (what the proxy answers for) and `PROXY_PORT` (the
  published host port). Default: `http://dashboard.localhost:8888`.
- `SEED_OWNER_FORCE_PASSWORD=true` is the only way to put the environment password
  back in force ("forgotten password" path). Default false: a password changed
  from the Compte page survives restarts.
- `NEXT_PUBLIC_DEFAULT_CURRENCY` / `NEXT_PUBLIC_DEFAULT_TIME_ZONE` default to
  `EUR` / `Europe/Paris`; only `NEXT_PUBLIC_*` reaches the browser.
- `src/lib/env.ts` validates the server variables on first use and fails loudly.

## Architecture rules (do not break)

- Modular monolith. No microservices, no message queue, **no Python/FastAPI** —
  server code is Next.js (Route Handlers, Server Actions).
- Business rules live in `src/modules/<module>` (domain/repository), never in
  pages or handlers.
- Writes go through Server Actions: the action re-validates with the same zod
  schema as the form, and every identifier from the browser is looked up
  owner-scoped (a foreign id is simply "not found").
- Authorisation is server-side everywhere: `requireUser()` for pages,
  `requireApiUser()` → 401 JSON for API routes. `src/proxy.ts` (Next 16's
  middleware file) is a UX redirect only.
- Money: exact decimals / decimal.js, never floats; negative = outflow; a positive
  amount on an expense is a reimbursement. A transaction takes its currency from
  its account, a linked cashflow from its transaction.
- Transfers count by sign and stay a **subset** of income/expenses (never added on
  top). Indicator definitions are documented in `docs/architecture/overview.md`.
- Secrets stay server-side: tokens encrypted at rest, `.env` git-ignored, no
  personal data in fixtures/screenshots/logs.
- After a write: `revalidatePath` in the action + `router.refresh()` in the client.
- Never pass a `Decimal` or a `Date` to a client component; map records to
  strings-only DTOs (see `toTransactionFormInitialValues`).

## Implemented

- Auth + `/account`: password change with server-enforced rules (min 12 chars,
  max 72 bytes); a change signs out every session (the token carries a password
  fingerprint).
- Budget: accounts, categories, transactions (create; edit reopens the row in the
  form via `?edit=<id>`; delete with a confirmation step); filters; monthly totals
  per currency; two server-rendered SVG charts (12-month trend, category breakdown)
  that always print exact figures; CSV export at `/api/export` (`no-store`,
  formula neutralisation).
- Real estate: properties (explicit occupancy — not all rented), cashflow entries
  (amount XOR transaction link), totals, due dates, notes.
- Integrations: read-only GitHub (projects, open issues + PRs, explorer with
  combinable filters validated against present data, milestones); encrypted tokens;
  manual idempotent sync (`src/jobs/sync.ts`), fetch bounded on purpose. GitLab is
  limited to project metadata by policy.
- Dashboard: indicators from stored snapshots; distinguishes "no data" /
  "not connected" / "synchronisation failed" — never shows a misleading 0.
- Backups (`infra/backups/`) and CI (lint, typecheck, tests, `db:deploy` on a fresh
  PostgreSQL service, build).

## Not implemented (do not assume they exist)

- No editable grid; accounts, categories and properties cannot be edited or deleted
  yet (only transactions can be deleted).
- No scheduler/cron for sync — the function exists, only the manual trigger ships.
- No bank connector, no payment/accounting/tax advice, no writing to GitHub or
  GitLab, no document storage, no AI features. Out of scope by design.

## Gotchas verified in this repo

- Next 16 renamed `middleware.ts` to `src/proxy.ts`; API routes are excluded from
  its matcher so they answer 401 JSON instead of redirecting.
- Prisma 7 requires the driver adapter (`new PrismaClient({ adapter: new PrismaPg(...) })`).
- The generated client is git-ignored: run `npm run db:generate` after install.
- The Docker image uses `output: "standalone"` (no devDependencies): run the app
  with `node server.js`; the Prisma CLI lives only in the `db-tools` stage (compose
  services `migrate` and `seed`).
- `AUTH_URL` must equal the origin actually browsed or sign-in redirects to an
  unreachable container host; Caddy answers an empty 200 for an unknown `Host`
  (a blank tab means a wrong name, not a crash); `*.localhost` resolves to loopback
  with no hosts entry (RFC 6761).
- The seed keeps the stored password unless `SEED_OWNER_FORCE_PASSWORD=true`;
  changing `SEED_OWNER_EMAIL` would create a second owner — the app assumes one.
- Adding a scalar-list column (`String[]`) leaves existing rows NULL; a backfill +
  NOT NULL follow-up migration is required (see `IssueSnapshot.assignees`).
- `next build` type-checks `*.test.ts`: re-run `npm run typecheck` after editing a test.
- Use `useWatch`, never `form.watch()` (React Compiler lint rule).
- A signed JWT can outlive its `User` row; `getSessionUser()` treats a missing row
  as signed out.
- This machine: host ports 5432 and 3000 are usually taken (another project uses
  them) — use `POSTGRES_PORT=5433` and `env PORT=3100 npm run dev`; Docker Desktop
  must be running.

## Verification recipes

- Never verify against real data. Use a throwaway project:
  `env POSTGRES_PORT=5544 docker compose -p smoke --profile full up -d db`, deploy +
  seed with fictitious `SEED_OWNER_*` values, dev server on 3100 with
  `AUTH_URL=http://localhost:3100` (otherwise sign-in redirects to the Docker
  origin), then `docker compose -p smoke --profile full down -v`.
- The unit suite needs no database; the reliable end-to-end check for a write flow
  is the throwaway stack above, then check the page, the totals and the export.

## Where to read more

- `README.md` — setup, proxy, scripts, environment variables, tests, production.
- `docs/architecture/overview.md` — modules, request flow, indicator definitions,
  security model, sync bounds.
- `AGENTS.md` — mission, scope, working principles, delivery expectations.
