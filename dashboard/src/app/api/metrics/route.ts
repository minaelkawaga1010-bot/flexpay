import { NextResponse } from 'next/server';
import { renderMetrics } from '@/lib/metrics';

export async function GET() {
  const metrics = renderMetrics();
  return new NextResponse(metrics, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  });
}
