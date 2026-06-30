# Database Migration — SQLite → PostgreSQL

Scope and current reality (verified against the repo, 2026-06-15):

| App | Path | Previous provider | Current provider |
|-----|------|-------------------|------------------|
| **Backend** (Express) | `prisma/schema.prisma` | `postgresql` | `postgresql` (unchanged — was never SQLite) |
| **Dashboard** (Next.js) | `dashboard/prisma/schema.prisma` | `sqlite` | `postgresql` (migrated in this change) |

> The backend has always targeted PostgreSQL. **Only the dashboard moves
> from SQLite to PostgreSQL.** This document covers (a) standing up the
> shared PostgreSQL/Redis stack, (b) migrating the dashboard's local
> SQLite dev dataset into PostgreSQL, and (c) the precision caveat.

---

## 0. Precision caveat — read first

Both schemas store monetary values as Prisma **`Float`** (IEEE-754
double), not `Decimal`. This was a deliberate, documented decision to
preserve **zero breaking changes** to existing data logic and the 372
passing backend tests (a `Float → Decimal` change makes Prisma return
`Decimal` objects, breaking every arithmetic call-site and assertion).

Implications for this migration:

- A `Float` round-trip from SQLite `REAL` → PostgreSQL `double precision`
  is **bit-exact** — both are IEEE-754 binary64. No precision is lost
  *in the migration itself*.
- `Float` is nonetheless **not** an exact-decimal type. Fils-level
  amounts (2 d.p. AED) are representable but not guaranteed exact under
  repeated arithmetic. The recommended long-term fix is a dedicated
  `Float → Decimal(18,2)` migration with coordinated call-site + test
  updates. That is tracked separately and intentionally **out of scope
  here.**
- Because the migration is binary64 → binary64, the safest backfill
  carries the raw numeric value across without re-parsing through a
  locale-formatted string (which *could* introduce rounding). The
  script below uses Prisma's typed read/write, which preserves the
  double exactly.

---

## 1. Stand up PostgreSQL + Redis

```bash
# From repo root. securepass is the dev default baked into
# src/config/env.ts; override POSTGRES_PASSWORD for staging/prod.
POSTGRES_PASSWORD=securepass docker compose up -d
docker compose ps          # wait until postgres + redis report (healthy)
```

This creates the `flexpay` database owned by role `flexpay`.

---

## 2. Backend (already PostgreSQL) — apply schema

```bash
export DATABASE_URL="postgresql://flexpay:securepass@localhost:5432/flexpay?schema=public"
npx prisma migrate deploy      # applies prisma/migrations/* (6 migrations)
npx prisma generate            # regenerates node_modules/.prisma/client
```

No data migration is required for the backend unless you are importing
an existing dataset (out of scope).

---

## 3. Dashboard — SQLite → PostgreSQL

The dashboard previously used `file:./prisma/dev.db`. The generator now
emits an **isolated** client to `dashboard/src/generated/prisma` so it
never collides with the backend's client in the shared `node_modules`.

### 3.1 Create the dashboard's PostgreSQL schema

Use a **separate database** (or schema) so the dashboard's 30 models do
not collide with the backend's 21 models in the same namespace.

```bash
# Create a dedicated database for the dashboard:
docker compose exec postgres \
  psql -U flexpay -c "CREATE DATABASE flexpay_dashboard;"

cd dashboard
export DATABASE_URL="postgresql://flexpay:securepass@localhost:5432/flexpay_dashboard?schema=public"
npx prisma migrate dev --name init_postgres   # generates + applies baseline
npx prisma generate                            # -> src/generated/prisma
```

### 3.2 Backfill the SQLite dev dataset

Run this **once**, with the SQLite file still present, before deleting
it. The script reads every table from the old SQLite client and writes
it to PostgreSQL via the new client, preserving insertion order so
foreign keys resolve. Adjust the model list to match your data volume.

```ts
// dashboard/scripts/backfill-sqlite-to-postgres.ts
// Run: npx tsx scripts/backfill-sqlite-to-postgres.ts
import { PrismaClient as PgClient } from '../src/generated/prisma';

// Point a throwaway SQLite client at the legacy file. Generate a
// second client from a copy of the OLD (sqlite) schema into a temp
// output, or check out the pre-migration schema on a branch.
import { PrismaClient as SqliteClient } from '../src/generated/prisma-sqlite';

const sqlite = new SqliteClient({ datasources: { db: { url: 'file:./prisma/dev.db' } } });
const pg = new PgClient();

// Insert parents before children — FK order matters.
const ORDER = [
  'user', 'wallet', 'balance', 'transaction', 'p2PTransfer',
  // …extend to all 30 models in dependency order…
] as const;

async function main() {
  for (const model of ORDER) {
    // @ts-expect-error dynamic model access
    const rows = await sqlite[model].findMany();
    for (const row of rows) {
      // createMany skips FK checks per-row; use create to fail loud on
      // a broken reference rather than silently dropping a row.
      // @ts-expect-error dynamic model access
      await pg[model].create({ data: row });
    }
    console.log(`migrated ${rows.length} ${model} rows`);
  }
}

main()
  .then(() => console.log('backfill complete'))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await sqlite.$disconnect(); await pg.$disconnect(); });
```

Notes:
- The `Float` columns are read and written as JS `number` (binary64)
  end-to-end — **no string re-parse, no rounding introduced.**
- For large tables, batch with `createMany({ data: chunk, skipDuplicates: true })`
  and chunk sizes of ~1,000 rows.
- SQLite stores booleans as `0/1` and DateTimes as ISO strings; Prisma's
  typed client normalises both on read, so the PostgreSQL write receives
  proper `Boolean` / `DateTime` values.

### 3.3 Update the dashboard environment

```bash
# dashboard/.env
DATABASE_URL="postgresql://flexpay:securepass@localhost:5432/flexpay_dashboard?schema=public"
```

### 3.4 Verify and decommission SQLite

```bash
cd dashboard
npx prisma generate
npx tsc --noEmit                 # 0 errors expected
# Smoke-test a read path, then archive the old file:
mv prisma/dev.db prisma/dev.db.pre-pg-backup
```

---

## 4. Rollback

The migration is additive — the SQLite file is archived, not deleted.
To roll back the dashboard: restore `dashboard/.env` to
`DATABASE_URL="file:./prisma/dev.db"`, revert the provider in
`dashboard/prisma/schema.prisma` to `sqlite`, restore the backup file,
and `npx prisma generate`.

---

## 5. Post-migration checklist

- [ ] `docker compose ps` → postgres + redis `(healthy)`
- [ ] Backend `prisma migrate deploy` clean; `tsc --noEmit` = 0
- [ ] Dashboard `prisma migrate dev` clean; `tsc --noEmit` = 0
- [ ] Row counts match between SQLite source and PostgreSQL target
- [ ] Spot-check 10 monetary values byte-for-byte (source vs target)
- [ ] Old `dev.db` archived, not deleted
- [ ] Future work ticket filed: `Float → Decimal(18,2)` precision migration
