# Engineering Decisions

This document records the main implementation choices for Newtonite Operations and the trade-offs behind them.

## Application structure

- **React, TypeScript, and Vite for the client:** This provides a typed, responsive single-page interface and a straightforward local development workflow.
- **Express and TypeScript for the API:** The API owns authentication, authorization, validation, and workflow rules instead of relying on client-side checks.
- **A single repository and development command:** The client and API are developed together and started with `npm run dev`, which keeps local setup simple. They remain separate processes and communicate through the API.

## Data storage

- **Prisma as the data-access layer:** The schema defines the application entities and relationships, while Prisma provides typed queries and supports local schema setup.
- **SQLite for local development:** It avoids requiring a separately installed database service and is suitable for a single-machine demonstration. This choice is not intended to imply that a local SQLite file is appropriate for a shared production deployment.
- **Prisma's SQLite driver adapter:** The runtime uses the `better-sqlite3` adapter to connect Prisma to SQLite.
- **Relational records for teams and work:** Users belong to teams through role-bearing memberships. Work items, comments, approvals, and activity records have explicit relations and indexes for common team-scoped queries.

## Authentication and access control

- **One-time first-run setup:** The first administrator and initial team are created through onboarding only when there are no users. There is no open self-service registration after setup; administrators add members through team management.
- **Bearer-token authentication:** The API uses JWTs to authenticate subsequent requests. Passwords are stored as hashes rather than plain text.
- **Team membership and roles:** Access is scoped to a user's team memberships, with role checks for privileged actions. This keeps authorization in the API rather than trusting the UI.
- **Environment-based secrets:** Local development can use a development secret, but production startup requires a private `JWT_SECRET` of at least 32 characters.

## Workflow correctness

- **Explicit work-item statuses and transitions:** The model represents work as a defined workflow, including an approval step, rather than accepting arbitrary status strings from the client.
- **Optimistic concurrency with versions:** Updates compare the submitted version with the stored version. A stale write is rejected instead of silently overwriting another user's changes.
- **Atomic claiming:** Claiming uses a conditional database update so that concurrent attempts cannot both claim the same unassigned item.
- **Idempotent creation:** Work-item creation accepts an idempotency key and records it with the result, allowing safe retries without duplicating work items.
- **Auditable collaboration:** Comments, activity events, and approval records are stored separately so work history is not reduced to the latest work-item state.

## Testing decisions

- **API integration tests use the real application and database layer:** They exercise onboarding, authentication, role access, idempotent creation, stale-write rejection, approvals, and concurrent claiming.
- **Tests create and remove their own records:** Integration tests clean up the temporary users, teams, and work items they create. They should run only against a development/test database, never production data.
- **Build checks complement tests:** `npm run build` checks the client build and TypeScript; `npm run server:build` checks the API compilation.

## Known trade-offs and future work

- The default SQLite database is local to one machine and does not provide a managed shared deployment, backup, or recovery strategy.
- The project is a development/prototype application, not a hardened production deployment. Production use needs deployment-specific database, secret management, HTTPS, CORS/network restrictions, backups, and operational monitoring.
- There is no self-service account registration or password reset/change flow. Accounts are provisioned by administrators.
- The current test suite focuses on important API behavior and includes a frontend smoke test; it is not a substitute for broader browser-based, accessibility, and deployment testing.
- For a multi-user deployment, evaluate PostgreSQL and an appropriate Prisma adapter, then add a managed migration and backup process before moving real operational data.
