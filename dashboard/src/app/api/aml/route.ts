import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEMO_PHONE = '+971501234567';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const severity = searchParams.get('severity');

    const where: Record<string, unknown> = {};
    if (severity) {
      where.severity = severity;
    }

    const alerts = await db.aMLAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, fullName: true, phone: true },
        },
      },
    });

    const stats = {
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === 'CRITICAL').length,
      high: alerts.filter((a) => a.severity === 'HIGH').length,
      medium: alerts.filter((a) => a.severity === 'MEDIUM').length,
      low: alerts.filter((a) => a.severity === 'LOW').length,
      unresolved: alerts.filter((a) => !a.isResolved).length,
    };

    return NextResponse.json({ alerts, stats });
  } catch (error) {
    console.error('AML GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { alertId, isResolved } = body;

    if (!alertId) {
      return NextResponse.json({ error: 'Alert ID is required' }, { status: 400 });
    }

    const alert = await db.aMLAlert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const shouldResolve = isResolved !== false && isResolved !== undefined;

    const updatedAlert = await db.aMLAlert.update({
      where: { id: alertId },
      data: {
        isResolved: shouldResolve,
        resolvedBy: shouldResolve ? 'admin' : null,
        resolvedAt: shouldResolve ? new Date() : null,
      },
    });

    return NextResponse.json({
      message: shouldResolve ? 'Alert resolved' : 'Alert reopened',
      alert: updatedAlert,
    });
  } catch (error) {
    console.error('AML PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
