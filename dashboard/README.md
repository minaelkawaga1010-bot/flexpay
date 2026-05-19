# FlexPay Dashboard (Next.js 15)

Admin / company surface for the FlexPay platform — built with Next.js 15
App Router, Tailwind, shadcn/ui, Prisma, and React Query.

This is the third surface alongside:
- `../` (Express backend serving the mobile API at `/api/v1`)
- `../mobile/` (React Native client)

## What's here

```
dashboard/
├── package.json, tsconfig.json, next.config.ts
├── tailwind.config.ts, postcss.config.mjs, components.json
├── eslint.config.mjs, middleware.ts
├── prisma/
│   └── schema.prisma     # self-contained SQLite schema (User/Wallet/Card/…)
├── public/
└── src/
    ├── app/              # App Router
    │   ├── api/          # 26 route groups (auth, wallet, cards, payroll, etc.)
    │   └── (pages)/
    ├── components/       # shadcn/ui + page components
    ├── hooks/
    ├── jobs/
    ├── lib/
    ├── services/         # NymCard client etc.
    └── store/
```

## Why a separate Prisma schema?

The dashboard's `prisma/schema.prisma` is SQLite-backed and User-centric
(`User`/`Wallet`/`Card`/`CreditScore`/…), which differs from the main
backend's Postgres schema (`Employee`/`Company`/`Card`). They're kept
separate so:

1. The dashboard runs end-to-end with a local SQLite for prototyping
   without depending on a Postgres + Redis stack.
2. The dashboard's API routes can talk directly to its own Prisma
   client without round-tripping through the Express backend.

For production, point the dashboard's `DATABASE_URL` at the same
Postgres instance the backend uses and reconcile the schemas — most
likely by adopting one canonical model and regenerating both clients
against it.

## Getting started

```bash
cd dashboard
bun install          # or: npm install
bunx prisma generate
bunx prisma db push  # creates dev.db
bun run dev          # http://localhost:3000
```

## Relationship to the OpenAPI spec

`docs/openapi.yaml` at the repo root is the canonical contract. It was
imported from this dashboard's reference and supersedes the partial
spec I wrote earlier — both the Express backend and the mobile app
should ultimately conform to it.
