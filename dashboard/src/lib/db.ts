import { PrismaClient, type Prisma } from '@/generated/prisma'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query-level logging emits every SQL statement WITH bound parameters —
// transfer amounts, phone numbers, balances, PII. That must never reach
// production stdout / log aggregators. Gate the log layers on the
// environment: verbose (but still no `query`) locally, errors only
// everywhere else.
const logLevels: Prisma.LogLevel[] =
  process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevels,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db