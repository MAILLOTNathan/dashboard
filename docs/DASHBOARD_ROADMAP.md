# Dashboard Roadmap for AI Coding Agent

**Repository snapshot:** 2026-10-05  
**Product:** single-owner personal steering dashboard  
**Interface language:** French  
**Code and documentation language:** English

## Purpose

Use this document to create GitHub milestones and issues for the dashboard repository.

The roadmap is intentionally incremental. It must respect the existing modular-monolith architecture and the scope defined in `AGENTS.md`.

The AI agent should create planning issues only unless implementation is explicitly requested.

## Product constraints

- Keep the application single-owner and single-tenant.
- Do not add public registration or multi-tenancy.
- Keep the modular monolith architecture: Next.js App Router, Server Actions, Route Handlers and PostgreSQL.
- Business rules belong in `src/modules/<module>`; pages and handlers must remain thin.
- Every browser-provided identifier must be looked up with owner-scoped authorization on the server.
- Keep provider credentials server-side and encrypted at rest.
- Never send integration credentials to the browser.
- Use `Decimal` and `decimal.js` for monetary values. Never use floating-point arithmetic for money.
- Preserve the existing transaction sign convention: negative values represent outflows.
- Preserve the existing transfer and property cashflow rules.
- Do not add bank connectors, accounting or tax advice, GitHub/GitLab write operations, document storage or AI features unless explicitly approved later.
- Every issue must include tests, migration considerations, security considerations and acceptance criteria.

## Suggested milestones

| Milestone | Goal | Priority | Issues |
|---|---|---:|---|
| M1 — Data Reliability | Make synchronization state, freshness and failures observable. | P0 | DR-01 to DR-05 |
| M2 — Budget Planning | Add budgets, recurring forecasts, goals and actionable alerts. | P0 | BP-01 to BP-06 |
| M3 — Real Estate Operations | Track financing, property metrics and due dates. | P1 | RE-01 to RE-05 |
| M4 — Development Activity | Turn GitHub/GitLab data into an actionable work view. | P1 | DA-01 to DA-05 |
| M5 — Security and Operations | Improve sessions, auditability, diagnostics and backups. | P1 | SO-01 to SO-05 |
| M6 — UX and Quality | Improve search, mobile use and invariant/property testing. | P2 | UX-01 to UX-05 |

Recommended sequencing: complete M1 before building projections or alerts because later modules depend on trustworthy freshness and synchronization status.

---

# M1 — Data Reliability

## DR-01 — Add synchronization run history

### Implementation

Create a `SyncRun` or `SynchronizationLog` model recording:

- integration or connection;
- start and end time;
- status: `RUNNING`, `SUCCESS`, `PARTIAL` or `FAILED`;
- number of items fetched, created, updated, skipped and failed;
- safe error summary;
- last successful run information.

Credentials, access tokens and sensitive provider payloads must never be written to logs.

### Acceptance criteria

- A sync run is persisted for every manual synchronization.
- Repeated synchronization remains idempotent.
- Successful, partial and failed runs are distinguishable.
- Unit tests cover success, partial failure and failure.
- Sensitive values are redacted.

## DR-02 — Display data freshness

### Implementation

Show the last successful synchronization, current status and stale-data warnings per integration and on the dashboard.

Distinguish clearly between:

- no data;
- integration not connected;
- never synchronized;
- stale data;
- synchronization failed.

### Acceptance criteria

- The UI never presents stale data as current.
- Empty and error states remain distinct.
- Server-side DTOs contain strings and serializable values only.
- The dashboard displays the timestamp of the latest successful synchronization.

## DR-03 — Add bounded synchronization retry behavior

### Implementation

Implement safe retry and backoff behavior for transient provider failures while preserving existing request bounds and idempotency.

### Acceptance criteria

- Retries are bounded.
- Rate-limit responses are handled safely.
- Permanent errors are not retried indefinitely.
- Retry decisions are covered by tests.
- The synchronization result clearly indicates whether retries were used.

## DR-04 — Add synchronization summary

### Implementation

After a manual synchronization, display a summary containing:

- created items;
- updated items;
- skipped items;
- failed items;
- duration;
- link to synchronization history.

### Acceptance criteria

- The summary is accurate after refresh.
- The summary does not reveal credentials or sensitive provider responses.
- Empty results are not represented as an unexplained success.

## DR-05 — Add retention policy for snapshots and logs

### Implementation

Define a retention policy for old provider snapshots, synchronization runs and diagnostic logs.

Implement a bounded server-side cleanup command or job. No scheduler is required unless explicitly approved.

### Acceptance criteria

- Cleanup is owner-scoped.
- Cleanup is bounded and safe to rerun.
- Recent snapshots and logs are preserved.
- The retention period is documented.
- Tests cover cleanup boundaries.

---

# M2 — Budget Planning

## BP-01 — Add monthly category budgets

### Implementation

Add owner-scoped monthly budgets per category and currency.

Provide create, edit and delete operations through Server Actions using shared Zod validation.

Prevent duplicate entries for the same owner, category, year, month and currency.

### Acceptance criteria

- Users can create, edit and delete a monthly budget.
- Duplicate month/category/currency entries are prevented.
- Amounts use exact decimals.
- Foreign category, user or account identifiers are not accepted.
- Tests cover authorization and currency separation.

## BP-02 — Add budget-versus-actual reporting

### Implementation

Display planned, actual and remaining or over-budget amounts by category and month.

Document the sign convention explicitly. Keep currencies separate.

### Acceptance criteria

- Reports use transaction `operationDate`.
- Months without transactions are handled correctly.
- Amounts are not converted implicitly between currencies.
- Over-budget states are visually clear.
- Calculations are covered by tests.

**Dependency:** BP-01.

## BP-03 — Add recurring transaction forecasts

### Implementation

Add recurring definitions for expected income and expenses without automatically creating accounting transactions.

Support confirmation, skipping and dismissal of forecasts.

### Acceptance criteria

- Forecasts do not silently alter actual transaction totals.
- Recurrence rules are validated.
- A confirmed forecast uses the existing transaction creation path.
- Skipped forecasts remain auditable.
- Date and timezone behavior is documented.

## BP-04 — Add financial goals

### Implementation

Add savings or repayment goals with:

- name;
- target amount;
- current amount or linked account;
- target date;
- currency;
- status.

Calculate progress and the required monthly contribution using exact decimals.

### Acceptance criteria

- Progress is displayed as an amount and percentage.
- Missing or unknown data is not displayed as zero.
- Currency is explicit.
- Calculations and edge cases are tested.
- Assumptions are documented.

## BP-05 — Add threshold and anomaly alerts

### Implementation

Add configurable alerts for:

- low account balance;
- budget overrun;
- unusual expense;
- stale integration data;
- overdue financial event.

Prefer deterministic rules before statistical heuristics.

### Acceptance criteria

- Every alert explains its reason.
- Duplicate alerts are avoided.
- Alerts can be dismissed.
- Alerts never modify transactions automatically.
- False or unavailable data is not presented as a confirmed anomaly.

## BP-06 — Add budget tests and CSV export fields

### Implementation

Extend unit and integration tests and add export filters for budgets, goals and alerts where appropriate.

### Acceptance criteria

- CSV exports remain formula-neutralized.
- Export access remains authenticated and owner-scoped.
- Tests cover currencies, dates, ownership and negative outflows.
- Large exports are handled safely.

---

# M3 — Real Estate Operations

## RE-01 — Add property financing

### Implementation

Track loans linked to properties, including:

- initial principal;
- outstanding balance;
- interest rate;
- term;
- payment amount;
- insurance amount;
- start and end dates.

### Acceptance criteria

- Loan data is owner-scoped.
- Monetary fields use `Decimal`.
- Operating cash flow is separated from financing costs.
- Property totals do not double-count linked transactions.
- Tests cover missing and partial loan data.

## RE-02 — Add property valuation and equity

### Implementation

Add optional property value history and calculate gross value, debt and estimated equity.

### Acceptance criteria

- Missing valuations are represented as unknown, not zero.
- Historical valuations remain auditable.
- Valuation currency is explicit.
- Debt and property value are not silently mixed across currencies.

## RE-03 — Add property KPIs

### Implementation

Calculate and display, where data is available:

- rental income;
- operating expenses;
- NOI;
- gross yield;
- net yield;
- occupancy;
- cash flow after financing.

Definitions must be documented in `docs/architecture/overview.md`.

### Acceptance criteria

- Date ranges are explicit.
- Currency handling is explicit.
- Empty and partial data are represented honestly.
- KPI definitions are documented.
- Calculations are tested.

**Dependencies:** RE-01 and RE-02 where applicable.

## RE-04 — Add property events and due dates

### Implementation

Create property events or tasks for:

- taxes;
- insurance;
- maintenance;
- leases;
- inspections;
- loan deadlines;
- renovation work.

Each event may contain a date, status, notes and optional amount.

### Acceptance criteria

- Overdue events are visible.
- Events can be filtered by property and status.
- Creating an event does not automatically create a payment transaction.
- Authorization and validation are server-side.

## RE-05 — Add property calendar view

### Implementation

Provide a month and list view for property events and financial due dates.

### Acceptance criteria

- Filtering by property and status works.
- Mobile layout is usable.
- Timezone behavior is documented.
- Unknown dates are not fabricated.

---

# M4 — Development Activity

## DA-01 — Add actionable work queue

### Implementation

Create an actionable view for:

- open issues;
- old pull requests;
- missing milestones;
- unreviewed pull requests;
- blocked work;
- issues without labels;
- milestones close to or past their due date.

### Acceptance criteria

- Filters are combinable and validated.
- Data age is shown.
- Provider failures are distinct from empty results.
- Every result links to the provider resource.
- No provider write operation is introduced.

## DA-02 — Add development activity metrics

### Implementation

Calculate bounded metrics such as:

- open pull request count;
- median pull request age;
- time from opening to merge;
- issue throughput;
- repository inactivity;
- milestone completion status.

Metric definitions must be documented.

### Acceptance criteria

- Metrics are reproducible from stored snapshots.
- Date ranges are explicit.
- Metrics are not presented as a definitive measure of developer productivity.
- Missing provider data is represented as unavailable.

**Dependency:** relevant snapshot data from the integration module.

## DA-03 — Add CI/CD status

### Implementation

Read provider workflow or check data and show recent failures, duration and affected branch where available.

### Acceptance criteria

- Provider API limits are respected.
- Unavailable data is shown as unavailable.
- Failed checks link to the provider resource.
- Provider response handling is tested.

## DA-04 — Improve provider caching

### Implementation

Use conditional requests and safe cache metadata where supported, while preserving encrypted token handling and existing request bounds.

### Acceptance criteria

- Unchanged resources avoid unnecessary processing where possible.
- Cache invalidation is documented.
- Cached results display their timestamp.
- Expired or failed cache data is not presented as current.

## DA-05 — Add repository health indicators

### Implementation

Show repository indicators such as:

- inactivity;
- missing description or topics;
- open issue backlog;
- stale milestones;
- missing project metadata.

### Acceptance criteria

- Indicators are explainable.
- Every indicator links to the provider resource.
- No GitHub or GitLab write operation is performed.
- Tests cover empty, partial and failed provider responses.

---

# M5 — Security and Operations

## SO-01 — Add active session management

### Implementation

List active sessions with safe metadata and allow revoking one session or all sessions.

Never display session tokens.

### Acceptance criteria

- Revocation is enforced server-side.
- Session metadata is minimized.
- Password changes continue to invalidate existing sessions.
- Tests cover revocation and missing users.

## SO-02 — Add audit log

### Implementation

Record security-sensitive and data-changing actions, including:

- authentication events;
- password changes;
- transaction changes;
- integration changes;
- synchronization requests;
- exports;
- backup and restore operations.

Do not store secrets or full sensitive payloads.

### Acceptance criteria

- Audit entries are owner-scoped.
- Sensitive values are redacted.
- The browser cannot modify audit records.
- Retention is documented.
- Tests cover redaction and authorization.

## SO-03 — Add system diagnostics

### Implementation

Add an authenticated diagnostics page or command for:

- database connectivity;
- migration state;
- encryption configuration;
- provider status;
- backup age;
- application version.

### Acceptance criteria

- Diagnostics do not expose secrets.
- Failures include actionable messages.
- Production output is safe to display.
- Diagnostics are not accessible without authentication.

## SO-04 — Verify backups

### Implementation

Add checksum and metadata validation plus a disposable-database restore test for backups.

### Acceptance criteria

- A backup is marked verified only after a successful restore check.
- Restore failures are visible in CI or operations documentation.
- Test data is fictitious.
- The process is documented and repeatable.

## SO-05 — Protect and extend exports

### Implementation

Add date and entity filters, audit export actions and safe handling for large exports.

### Acceptance criteria

- Exports remain authenticated and owner-scoped.
- `Cache-Control: no-store` remains enforced.
- Formula neutralization remains enforced.
- Large exports do not exhaust memory.
- Export filters are covered by tests.

---

# M6 — UX and Quality

## UX-01 — Add global search

### Implementation

Search owner-scoped:

- transactions;
- accounts;
- properties;
- projects;
- issues;
- milestones.

Use pagination or strict result bounds.

### Acceptance criteria

- Results are authorization-safe.
- Results are bounded or paginated.
- Search is keyboard accessible.
- Empty and provider-error states are distinct.

## UX-02 — Add quick actions

### Implementation

Provide quick transaction creation, common filters and keyboard navigation without bypassing existing validation.

### Acceptance criteria

- Quick actions use the same Server Actions and Zod schemas as regular forms.
- Authorization remains server-side.
- Success and failure states are visible.
- `revalidatePath` and client refresh behavior remain correct.

## UX-03 — Improve responsive and PWA behavior

### Implementation

Optimize mobile forms and tables, add dark mode and optionally add installable PWA support.

Do not cache sensitive personal data in unsafe offline storage.

### Acceptance criteria

- Private data is not placed in unsafe offline caches.
- The interface remains usable on small screens.
- Reduced-motion preferences are respected.
- Dark-mode contrast is accessible.

## UX-04 — Add invariant and property tests

### Implementation

Add tests for the core invariants:

- owner-scoped authorization;
- exact money calculations;
- property cashflow amount-or-transaction XOR;
- transfer inclusion rules;
- idempotent synchronization;
- DTO serialization;
- no `Decimal` or `Date` values passed to client components.

### Acceptance criteria

- Tests run without real personal data.
- Invariant violations fail the test suite.
- Tests cover both valid and invalid states.
- The test suite remains deterministic and network-free.

## UX-05 — Document operational runbooks

### Implementation

Document:

- migration deployment;
- backup and restore;
- provider token rotation;
- failed synchronization recovery;
- smoke verification;
- local development setup;
- production diagnostics.

### Acceptance criteria

- A new maintainer can follow the procedures using fictitious data.
- Commands match the current repository scripts.
- Sensitive values are never included in examples.
- Documentation is reviewed when operational behavior changes.

---

# Instructions for the AI agent

## Before creating issues

1. Inspect existing GitHub milestones, labels and open issues.
2. Reuse matching milestones, labels and issues instead of creating duplicates.
3. Read `AGENTS.md`, `README.md` and `docs/architecture/overview.md`.
4. Check whether any listed issue already exists under a different title.
5. Identify dependencies between issues before creating them.

## Milestone creation order

Create or reuse milestones in this order:

1. M1 — Data Reliability
2. M2 — Budget Planning
3. M3 — Real Estate Operations
4. M4 — Development Activity
5. M5 — Security and Operations
6. M6 — UX and Quality

## Issue creation rules

Create one GitHub issue per issue title in this document. Do not combine unrelated issues.

Every issue must contain:

- Context;
- proposed scope;
- non-goals;
- technical notes;
- dependencies;
- acceptance criteria;
- testing requirements;
- migration notes;
- security and authorization notes.

Use the issue identifier in the title, for example:

```text
[DR-01] Add synchronization run history
```

Do not implement code while creating planning issues unless explicitly requested.

Keep issue titles in English. Preserve the repository convention: French user interface, English source code, comments and technical documentation.

If a requested feature conflicts with `AGENTS.md`, stop and flag the conflict instead of silently changing the architecture.

## Suggested labels

| Label | Purpose |
|---|---|
| `priority:P0` | Foundational or high-value work |
| `priority:P1` | Important follow-up |
| `priority:P2` | Quality or convenience |
| `type:feature` | New user-facing capability |
| `type:security` | Security, authorization or secrets |
| `type:infra` | Deployment, backup or operations |
| `type:testing` | Tests and verification |
| `type:docs` | Documentation and runbooks |
| `area:budget` | Budget module |
| `area:real-estate` | Real-estate module |
| `area:integrations` | Provider integrations |
| `area:dashboard` | Dashboard and reporting |
| `area:auth` | Authentication and sessions |
| `area:platform` | Cross-cutting platform work |

Only create missing labels after checking the repository's existing label convention.

## Definition of done

An issue is complete only when:

- Business logic is implemented in the relevant module, not in the page component.
- Inputs are validated server-side with Zod.
- Authorization is owner-scoped.
- No `Decimal` or `Date` object is passed to a client component.
- Unit tests cover normal, empty, invalid, unauthorized and failure cases.
- Migrations are safe and documented.
- Lint, typecheck, tests and production build pass.
- No personal data, real provider tokens or real account identifiers are added to fixtures, logs or screenshots.
- README or architecture documentation is updated when behavior or operational procedures change.
