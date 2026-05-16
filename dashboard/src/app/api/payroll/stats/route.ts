/**
 * Payroll Statistics API Route
 *
 * GET /api/payroll/stats — Payroll statistics and metrics
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ==================== GET: Payroll Stats ====================

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

    // Run aggregation queries in parallel
    const [
      totalProcessed,
      totalAmountResult,
      completedPayrolls,
      failedCount,
      pendingCount,
      activeSchedulesCount,
    ] = await Promise.all([
      // Total completed payrolls
      db.payroll.count({
        where: {
          companyUserId,
          status: 'COMPLETED',
        },
      }),

      // Total amount disbursed
      db.payroll.aggregate({
        where: {
          companyUserId,
          status: 'COMPLETED',
        },
        _sum: { netAmount: true },
      }),

      // Recent completed payrolls for processing time calc
      db.payroll.findMany({
        where: {
          companyUserId,
          status: 'COMPLETED',
          processedAt: { not: null },
        },
        select: {
          createdAt: true,
          processedAt: true,
        },
        orderBy: { processedAt: 'desc' },
        take: 50,
      }),

      // Failed count
      db.payroll.count({
        where: {
          companyUserId,
          status: 'FAILED',
        },
      }),

      // Pending count
      db.payroll.count({
        where: {
          companyUserId,
          status: 'PENDING',
        },
      }),

      // Active schedules count
      db.scheduledPayroll.count({
        where: {
          companyUserId,
          isActive: true,
        },
      }),
    ]);

    // Calculate average processing time (in seconds)
    let avgProcessingTime = 0;
    const payrollsWithTime = completedPayrolls.filter((p) => p.processedAt !== null);
    if (payrollsWithTime.length > 0) {
      const totalTime = payrollsWithTime.reduce((sum, p) => {
        return sum + (p.processedAt!.getTime() - p.createdAt.getTime());
      }, 0);
      avgProcessingTime = Math.round(totalTime / payrollsWithTime.length / 1000);
    }

    // Get batch stats
    const batchResult = await db.payroll.groupBy({
      by: ['batchId'],
      where: {
        companyUserId,
      },
      _count: { id: true },
      _sum: { netAmount: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
      orderBy: { _min: { createdAt: 'desc' } },
      take: 10,
    });

    return NextResponse.json({
      totalProcessed,
      totalAmount: totalAmountResult._sum.netAmount ?? 0,
      avgProcessingTime,
      failedCount,
      pendingCount,
      activeSchedules: activeSchedulesCount,
      recentBatches: batchResult.map((batch) => ({
        batchId: batch.batchId,
        employeeCount: batch._count.id,
        totalAmount: batch._sum.netAmount ?? 0,
        firstProcessedAt: batch._min.createdAt,
        lastProcessedAt: batch._max.createdAt,
      })),
    });
  } catch (error) {
    console.error('Payroll Stats GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
