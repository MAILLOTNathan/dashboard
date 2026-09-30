# 0001 — Modular monolith, Next.js + PostgreSQL

- Status: accepted
- Date: 2026-09-30

## Context

The dashboard is a single-user companion for one entrepreneur: personal budget,
real-estate assets, and read-only GitHub/GitLab activity. It must stay useful
daily, cheap to host and simple to maintain. Financial data and private
repository access make security and data integrity the primary constraints.

## Decision

- **One Next.js application** (App Router, TypeScript) serves both the interface
  and the server logic. No separate API service.
- **Business rules live in `src/modules/<module>`**, never in components or
  Route Handlers. Modules are the seams along which the code can grow.
- **PostgreSQL** with Prisma, using driver adapters (Prisma 7 requirement) and a
  versioned migration history.
- **Auth.js with a credentials provider** and a JWT session, because there is a
  single owner and no public sign-up. The session cookie carries only an
  identifier.
- **Exact decimals** (`numeric(18, 2)`) for money, and a date-only type for
  operation dates.
- **Docker Compose** for the local environment and the first deployment.

## Alternatives considered

- *FastAPI or another Python backend*: rejected. It adds a second runtime,
  deployment and auth implementation for a single-user tool.
- *Microservices, a queue or a worker fleet*: rejected. There is no
  demonstrated need; a scheduled job calling an idempotent function is enough.
- *Store amounts as integers in minor units*: viable and exact. `numeric(18, 2)`
  was preferred because it survives a currency with a different number of
  decimals without a schema change, and Prisma maps it to an exact decimal type
  rather than a float.
- *OAuth device flow for providers*: not yet. Tokens entered manually with
  read-only scopes are simpler, keep no browser-side secret, and can be replaced
  later without touching the normalisation layer.

## Consequences

- The whole application scales as one unit; that is acceptable for one user.
- Anything touching the server must be careful about client/server boundaries:
  a database client or a secret imported into a client component would leak.
  `getPrisma()` and `getServerEnv()` therefore throw when called in a browser.
- The proxy is not a security boundary. Every page, Route Handler and Server
  Action re-checks the session, and API routes answer 401 instead of redirecting.
- Prisma's generated client is not committed; `npm run db:generate` must run
  before type checking, testing or building.
