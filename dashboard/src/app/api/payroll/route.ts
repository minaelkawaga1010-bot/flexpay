/**
 * Payroll API Routes
 *
 * GET  /api/payroll          — List payroll records (paginated, filterable)
 * POST /api/payroll/run      — Trigger manual payroll run
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { payrollQueue } from '@/jobs/payroll-job';
import { generateBatchId } from '@/jobs/payroll-processor';

// ==================== GET: List Payroll Records ====================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const companyUserId = searchParams.get('companyUserId');
    const status = searchParams.get('status');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);

    if (!companyUserId) {
      return NextResponse.json(
        { error: 'companyUserId is required' },
        { status: 400 },
      );
    }

    // Build where clause
    const where: Record<string, unknown> = { companyUserId };

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (from || to) {
      where.createdAt = {};
      if (from) {
        (where.createdAt as Record<string, unknown>).gte = new Date(from);
      }
      if (to) {
        // Set to end of day
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        (where.createdAt as Record<string, unknown>).lte = toDate;
      }
    }

    // Fetch paginated results
    const [payrolls, total] = await Promise.all([
      db.payroll.findMany({
        where,
        include: {
          employee: {
            select: {
              employeeId: true,
              position: true,
              department: true,
              user: { select: { fullName: true, phone: true } },
            },
          },
          transaction: {
            select: { id: true, reference: true, createdAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.payroll.count({ where }),
    ]);

    return NextResponse.json({
      payrolls,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error('Payroll GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// ==================== POST: Trigger Manual Payroll Run ====================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyUserId, employeeUserIds } = body as {
      companyUserId: string;
      employeeUserIds?: string[];
    };

    if (!companyUserId) {
      return NextResponse.json(
        { error: 'companyUserId is required' },
        { status: 400 },
      );
    }

    // Verify the company exists
    const company = await db.user.findUnique({
      where: { id: companyUserId },
    });

    if (!company) {
      return NextResponse.json(
        { error: 'Company user not found' },
        { status: 404 },
      );
    }

    // Check for employees
    const employeeCount = await db.employee.count({
      where: {
        companyUserId,
        employmentStatus: 'ACTIVE',
        ...(employeeUserIds && employeeUserIds.length > 0
          ? { userId: { in: employeeUserIds } }
          : {}),
      },
    });

    if (employeeCount === 0) {
      return NextResponse.json(
        { error: 'No active employees found for this company' },
        { status: 400 },
      );
    }

    // Generate batch ID and queue the payroll
    const batchId = await generateBatchId();

    const jobId = await payrollQueue.add(
      'manual-payroll',
      {
        companyUserId,
        batchId,
        employeeUserIds,
        triggeredBy: 'MANUAL',
      },
      { attempts: 3 },
    );

    // Audit log
    await db.auditLog.create({
      data: {
        userId: companyUserId,
        action: 'PAYROLL_MANUAL_TRIGGER',
        resource: 'Payroll',
        details: JSON.stringify({
          batchId,
          jobId,
          employeeCount,
          employeeUserIds,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      batchId,
      jobId,
      message: `Payroll queued for ${employeeCount} employee(s)`,
    });
  } catch (error) {
    console.error('Payroll POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
