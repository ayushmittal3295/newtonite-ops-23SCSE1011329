# Newtonite Operations

Operations dashboard with a React/Vite frontend, Express API, Prisma ORM, and SQLite for local development.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## First-time local setup

1. Install packages:

   ```powershell
   npm install
   ```

2. Create `.env` from `.env.example` and set a private JWT secret:

   ```powershell
   Copy-Item .env.example .env
   ```

   Keep `.env` private. The default database URL creates a local SQLite database named `dev.db`.

3. Generate Prisma Client and apply the schema:

   ```powershell
   npx prisma generate
   npm run db:push
   ```

4. Start the application:

   ```powershell
   npm run dev
   ```

5. Open [http://localhost:5173](http://localhost:5173). Choose **Set up the first account and team** on the login page to create the initial administrator and team.

The setup route is available only while the database has no users. After creating the first administrator, use **Teams** to add teams and member accounts, then **Create work item** to enter operational data. New team-member passwords should be shared securely and changed outside this prototype if necessary.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend and API |
| `npm run build` | Build the frontend and type-check the project |
| `npm test` | Run smoke and database-backed API tests |
| `npm run db:push` | Apply Prisma schema changes to the configured database |

`npm run db:seed` is optional demo data only. It deletes existing records and replaces them with demo users, teams, and work items; do not use it for real data.

## Database and deployment

SQLite is configured for a single-machine development instance. For a shared deployment, configure PostgreSQL and its Prisma driver adapter, use a strong private `JWT_SECRET`, restrict CORS and network access, and use a managed migration/backup process. Do not point the development seed or integration tests at production data. This repository is not yet configured as a hardened production deployment.
