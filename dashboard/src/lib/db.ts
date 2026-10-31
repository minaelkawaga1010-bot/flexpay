import { PrismaClient } from '@/generated/prisma'
import { resolveQueryLogLevels } from '@/lib/log-policy'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // C-1: never `query` (it logs bound SQL params / PII). Gated on env
    // via resolveQueryLogLevels — warn+error in development, error-only
    // everywhere else. Preserves error-level observability.
    log: resolveQueryLogLevels(),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db