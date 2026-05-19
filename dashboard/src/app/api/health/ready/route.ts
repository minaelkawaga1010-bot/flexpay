import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const checks: {
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    latency_ms: number;
    details?: string;
  }[] = [];

  // 1. Database connectivity check
  const dbStart = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.push({
      name: 'database',
      status: 'healthy',
      latency_ms: Date.now() - dbStart,
    });
  } catch (err) {
    checks.push({
      name: 'database',
      status: 'unhealthy',
      latency_ms: Date.now() - dbStart,
      details: err instanceof Error ? err.message : 'Connection failed',
    });
  }

  // 2. Memory check
  const memUsage = process.memoryUsage();
  const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  checks.push({
    name: 'memory',
    status:
      heapPercent > 90
        ? 'unhealthy'
        : heapPercent > 75
          ? 'degraded'
          : 'healthy',
    latency_ms: 0,
    details: `heap: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)}MB (${heapPercent.toFixed(1)}%)`,
  });

  const allHealthy = checks.every((c) => c.status === 'healthy');

  return NextResponse.json(
    {
      status: allHealthy ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
    },
    {
      status: allHealthy ? 200 : 503,
    },
  );
}
