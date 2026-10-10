/**
 * Prisma logging policy — C-1 security fix (TASK-005).
 *
 * Prisma's `query` log level emits every executed SQL statement WITH its
 * bound parameters — transfer amounts, phone numbers, balances, tokens,
 * any PII column. That must never reach stdout / a log aggregator in any
 * shared or production environment.
 *
 * This helper gates the log levels on NODE_ENV and, critically, can
 * NEVER return `query`: the return type is `Exclude<PrismaLogLevel,
 * 'query'>[]`, so a future edit that tries to add it fails to compile.
 *   - development → warn + error (local diagnostics; still no query)
 *   - production / test / unknown → error only
 *
 * Kept dependency-free (local type, no Prisma import) so it is unit-
 * testable in isolation without the generated client or a database.
 */

export type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

export function resolveQueryLogLevels(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Exclude<PrismaLogLevel, 'query'>[] {
  return nodeEnv === 'development' ? ['warn', 'error'] : ['error'];
}
