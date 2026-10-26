# PostgreSQL and companion setup

Workflow Studio requires PostgreSQL. Use a PostgreSQL server on the same computer for local testing or a managed PostgreSQL service such as Aiven for deployment. The local companion does not connect to the database and never receives database credentials.

## Local PostgreSQL

Create a database and login with PostgreSQL tooling or pgAdmin, then add these values to `.env.local`:

```dotenv
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=workflow_studio
PGPASSWORD=replace-me
PGDATABASE=workflow_studio
PGSSL_MODE=disable
```

The database login must be allowed to connect and create objects in the database. Workflow Studio creates its `workflow_studio` schema and versioned tables during startup.

## Aiven PostgreSQL

Download the Aiven CA certificate into `certs/aiven-ca.pem`. Keep the password in the deployment secret store, then configure:

```dotenv
PGHOST=your-service.aivencloud.com
PGPORT=16251
PGUSER=avnadmin
PGPASSWORD=replace-me
PGDATABASE=defaultdb
PGSSL_MODE=verify-ca
PGSSL_CA_FILE=./certs/aiven-ca.pem
```

You may set `DATABASE_URL` instead of the five connection fields. TLS settings still come from `PGSSL_MODE`; use `verify-ca` with `PGSSL_CA_FILE` for Aiven certificate verification.

## Verify and run

```powershell
npm install
npm run db:check
npm run dev
```

`db:check` prints the PostgreSQL server version when the connection succeeds. Start Workflow Studio once so it applies its schema, stop it, and then run:

```powershell
npm run db:verify
```

This checks required tables, indexes, migration records, and the immutable audit trigger. The application health endpoint reports PostgreSQL readiness and migration status.

## Backup and restore rehearsal

Install PostgreSQL client tools and put `pg_dump` and `pg_restore` on `PATH`, or set `PG_BIN_DIR` to their directory. Create a custom-format backup with `npm run db:backup`. Restore only into a disposable target database:

For a disposable scale rehearsal, seed between 10 and 10,000 users only after explicitly enabling fixture seeding:

```powershell
$env:WORKFLOW_STUDIO_ALLOW_FIXTURE_SEED='true'
$env:WORKFLOW_STUDIO_FIXTURE_USERS='1000'
npm run db:seed-scale-fixture
```

The command refuses databases whose name does not contain `test`, `validation`, or `fixture` unless `WORKFLOW_STUDIO_CONFIRM_FIXTURE_DATABASE` exactly matches `PGDATABASE`.

```powershell
npm run db:restore -- --file .\backups\workflow-studio-TIMESTAMP.dump --confirm
npm run db:verify
```

After restoring into a separate database, compare every table by row count and deterministic content fingerprint:

```powershell
$env:PGSOURCE_DATABASE='workflow_studio_validation'
$env:PGRESTORE_DATABASE='workflow_studio_restore_validation'
npm run db:compare
```

The restore command requires the explicit `--confirm` flag. Keep production backups encrypted and retained through the database provider's approved backup policy.

## Companion boundary

The deployed website stores accounts, sessions, workflows, runs, approvals, pairing records, audit events, assignments, and skill metadata in PostgreSQL. Each user's companion keeps Codex authentication and local workspace access on that user's computer. Changing the website database does not change how the companion starts or runs. If pairing records are moved or reset, generate a new one-time pairing code and reconnect.
