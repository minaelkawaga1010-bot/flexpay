/**
 * Payroll Schedules API Routes
 *
 * GET  /api/payroll/schedules  — List scheduled payrolls
 * POST /api/payroll/schedules  — Create a new scheduled payroll
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { calculateNextRunDate } from '@/jobs/payroll-processor';

// ==================== GET: List Scheduled Payrolls ====================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyUserId = searchParams.get('companyUserId');

    if (!companyUserId) {
      return NextResponse.json(
        { error: 'companyUserId is required' },
        { status: 400 },
      );
    }

    const schedules = await db.scheduledPayroll.findMany({
      where: { companyUserId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ schedules });
  } catch (error) {
    console.error('Payroll Schedules GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// ==================== POST: Create Scheduled Payroll ====================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      companyUserId,
      name,
      frequency,
      payDay,
      totalEmployees,
      totalAmount,
    } = body as {
      companyUserId: string;
      name: string;
      frequency: string;
      payDay: number;
      totalEmployees?: number;
      totalAmount?: number;
    };

    // Validate required fields
    if (!companyUserId || !name || !frequency || !payDay) {
      return NextResponse.json(
        { error: 'companyUserId, name, frequency, and payDay are required' },
        { status: 400 },
      );
    }

    // Validate frequency
    const validFrequencies = ['MONTHLY', 'BIWEEKLY', 'WEEKLY'];
    if (!validFrequencies.includes(frequency)) {
      return NextResponse.json(
        { error: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate payDay based on frequency
    if (frequency === 'MONTHLY' || frequency === 'BIWEEKLY') {
      if (payDay < 1 || payDay > 28) {
        return NextResponse.json(
          { error: 'payDay must be between 1 and 28 for monthly/biweekly schedules' },
          { status: 400 },
        );
      }
    } else if (frequency === 'WEEKLY') {
      if (payDay < 1 || payDay > 7) {
        return NextResponse.json(
          { error: 'payDay must be between 1 (Monday) and 7 (Sunday) for weekly schedules' },
          { status: 400 },
        );
      }
    }

    // Verify company exists
    const company = await db.user.findUnique({
      where: { id: companyUserId },
    });

    if (!company) {
      return NextResponse.json(
        { error: 'Company user not found' },
        { status: 404 },
      );
    }

    // Calculate next run date
    const nextRunAt = calculateNextRunDate(frequency, payDay);

    // Create the schedule
    const schedule = await db.scheduledPayroll.create({
      data: {
        companyUserId,
        name,
        frequency,
        payDay,
        isActive: true,
        nextRunAt,
        totalEmployees: totalEmployees ?? 0,
        totalAmount: totalAmount ?? 0,
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        userId: companyUserId,
        action: 'SCHEDULED_PAYROLL_CREATE',
        resource: 'ScheduledPayroll',
        details: JSON.stringify({
          scheduleId: schedule.id,
          name,
          frequency,
          payDay,
          nextRunAt: schedule.nextRunAt.toISOString(),
        }),
      },
    });

    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    console.error('Payroll Schedules POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
