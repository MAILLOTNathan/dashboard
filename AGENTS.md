# AGENTS.md

## Mission

Build a personal steering companion for an entrepreneur: software projects, GitHub and GitLab activity, real-estate assets and personal budget. The product must be useful on a daily basis, quick to consult, simple to maintain and particularly careful with financial data and access to private repositories.

This file guides any development agent working in the repository. It describes the project's intentions, not proof that the features or commands already exist. Before any modification, inspect the repository and adapt the instructions to its actual state. Do not invent existing structure, dependencies, scripts or features.

## Working principles

- Deliver small, coherent and verifiable changes. Start with the simplest solution that meets the need.
- Favour a modular monolithic application. Do not introduce microservices, Kubernetes or message buses without a demonstrated need.
- Do not use FastAPI and do not create a Python backend. Server code belongs to the Next.js application, unless an explicit later architectural decision says otherwise.
- Keep personal data separate from company data; do not merge their access rights or their metrics by default.
- Never fetch or display more company GitLab information than what is explicitly authorised. Anticipate that a GitLab instance may be self-hosted.
- Handle amounts, dates, time zones and currencies explicitly. Initial currency: EUR, configurable in the model if necessary. Initial interface language: French.
- Prefer readable interfaces and usable tables over decorative charts.
- Explain any significant trade-off in the PR or the task description, especially security, data migration and hosting cost.

## Target stack

The proposed stack may be adjusted if the repository already imposes other choices:

- Application: Next.js with TypeScript, frontend and server logic in the same project.
- Server access: Route Handlers and/or Server Actions depending on the use case; business logic in dedicated modules rather than in components or handlers.
- Database: PostgreSQL with a migration tool and a TypeScript client chosen according to the repository's conventions.
- Local environment and first deployment: Docker Compose.
- CI: tests, lint, type checking and build.

Suggested layout if the repository is new:

```text
src/
  app/                 # pages, layouts, Route Handlers, targeted Server Actions
  components/          # interface components
  modules/
    identity/
    budget/
    real-estate/
    integrations/
    dashboard/
  lib/                 # database access, configuration, cross-cutting utilities
  jobs/                # synchronisation tasks run server-side
infra/
  backups/             # procedures/scripts, never the actual backups
docs/
  architecture/
  decisions/
compose.yaml
.env.example
AGENTS.md
```

Do not create all these folders empty. Follow the conventions actually present in the repository. Never import a module containing secrets or a database client into a client component.

## Functional scope

### First version

1. Owner authentication; no public sign-up by default.
2. Home dashboard with shortcuts and indicators defined from real data.
3. Personal budget: manual accounts, transactions, categories, income, expenses, filters, monthly totals and an editable spreadsheet view.
4. Real estate: properties, expenses, rental income where relevant, due dates and notes. Do not assume that all properties are rented.
5. GitHub and GitLab connections: display the authorised projects and a few useful indicators; start read-only.
6. Export of personal data in a reusable format, at minimum CSV for transactions and properties.

### Out of initial scope

- Automatic bank connection, payment, official accounting or automated tax advice.
- Multi-tenant deployment, public sharing of the dashboard or management of a complete team.
- Automatic writing to GitHub or GitLab, unless an explicitly validated later need arises.
- AI, financial recommendations or complex aggregation before having reliable data.

A bank connector or company data must never be added merely in anticipation: clarify authorisations, responsibilities and security needs first.

## Modules and data

Define clear business boundaries: `identity`, `budget`, `real-estate`, `integrations`, `dashboard`. A suggestion for the initial model:

- `Transaction`: identifier, date, label, amount in an exact monetary unit, currency, category, account, type and optional notes.
- `Account`: a manually tracked account, name, type and currency; do not store unnecessary banking credentials.
- `Property`: name, optional address, occupancy status, useful dates and notes.
- `PropertyCashflow`: link to a property and a transaction or financial entry; avoid double counting in totals.
- `IntegrationConnection`: provider, instance URL for GitLab if necessary, owner, granted permissions, state and synchronisation dates. Secrets do not belong in responses sent to the browser.
- `ProjectSnapshot` or equivalent: synchronised data strictly necessary for the dashboard, with source and last-updated date.

These names are indicative: keep the model minimal and let it evolve with real use cases. Use integer amounts in the smallest monetary unit or an exact decimal type; never floating point for financial calculations. Store instants in UTC and display dates in the time zone chosen by the user. Distinguish operation date, creation date and synchronisation date.

## GitHub and GitLab integrations

- Prefer the authorisation mechanism suited to the provider and to minimal permissions. Do not request write access for a read-only display.
- Keep secrets and tokens server-side only, encrypted at rest if stored; never put them in JavaScript shipped to the browser, in logs or in Git.
- Isolate adapters per provider and normalise only the fields needed by the interface. Keep the URL and the original identifier of external objects.
- Handle pagination, rate limiting, access expiry/revocation, network errors and partial synchronisation. Display the last successful synchronisation and errors without exposing sensitive data.
- Allow selecting the tracked groups, organisations or repositories. Respect the company's policy before any connection to its GitLab; do not copy private source code content into the dashboard without an explicit need.
- Test integrations with simulated responses; do not require real tokens in tests.

Deferred synchronisations must run server-side through a mechanism suited to the chosen deployment: scheduled task or lightweight worker if necessary. Do not start permanent loops in the web process assuming it will always stay alive. Make synchronisations re-runnable without creating duplicates.

## Security and privacy

- Every route, server action or query giving access to the budget, properties or private repositories requires a server-side authentication and authorisation check. Never treat a frontend display check as protection.
- Provide secure sessions, appropriate cookies, cross-site request protection according to the authentication mode and strict input validation.
- Separate public configuration from secrets. Provide `.env.example` with fictitious values; ignore `.env`, real exports, local databases, attachments and backups.
- Avoid personal data in logs, traces, analytics and error captures. Do not add third-party telemetry by default.
- Limit file access and define a size/type policy for supporting documents if this feature is added.
- Do not expose PostgreSQL directly on the Internet. Provide HTTPS, dependency updates, encrypted backups and a restore test.
- Never use the user's real transactions or documents in fixtures, screenshots, examples or tests.

## Interface and server contracts

- Define explicit input and output contracts, with data validation and consistent error responses. Document amount and date formats.
- Keep client components limited to the necessary interactions; leave access to sensitive data and business calculations server-side.
- For the spreadsheet view: keyboard-accessible editing, visible validation, predictable sorting and filters, confirmation before deletion and indication of save errors.
- Do not mask a lack of synchronisation or data with a misleading zero: distinguish "no data", "not connected" and "synchronisation error".
- Take care of the mobile version for consultation, without sacrificing the spreadsheet ergonomics on desktop.
- Only compute an indicator if its definition is documented. For example, specify whether the monthly balance includes or excludes transfers between accounts.

## Deployment

GitHub Pages can host a static interface, but not this complete application on its own. Since Next.js here provides both the interface and the server, the default deployment path is a Next.js instance on a VPS with Docker Compose, an HTTPS proxy and PostgreSQL with a persistent volume and backups. An application platform compatible with Next.js server functions may also be suitable, with a PostgreSQL database hosted separately.

Do not configure a Next.js static export as the main deployment: server routes, authentication and PostgreSQL access must remain operational. Never publish financial data in a repository, a CI artifact or static files. Provide a reproducible local environment, database migrations and a documented restore procedure before going to production.

## Quality and tests

For each change:

1. Read the existing conventions, scripts and tests before coding.
2. Add or adapt migrations when the schema evolves; avoid destructive migrations without a recovery strategy.
3. Test business rules: negative amounts, reimbursements, transfers, months without data, cut-off dates, non-rented properties and import duplicates.
4. Test unauthorised access and provider connection/synchronisation failures.
5. Run the lint, test, type-check and build commands actually defined in the repository. If they do not exist, report it rather than claiming to have run them.
6. Update the documentation and `.env.example` when a variable or a deployment step changes.

For any financial feature, include at least one test verifying a calculation or a business rule. For any external integration, provide at least one nominal case and one error case.

## Delivery method

Before starting a task, identify the module concerned, the data handled, the required rights and the acceptance criteria. If a structuring decision is missing — for example the scope of the company GitLab, document storage or the authentication mode — ask for a targeted clarification instead of inventing a requirement.

At the end, provide: what changed, the migrations or variables to plan for, the commands actually run with their result, the known limitations and the strictly necessary next steps. Do not present a mockup as a connected feature or a simulated synchronisation as a real synchronisation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
