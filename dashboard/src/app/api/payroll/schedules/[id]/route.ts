/**
 * Payroll Schedule Update API Route
 *
 * PATCH /api/payroll/schedules/[id] — Update a scheduled payroll
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { calculateNextRunDate } from '@/jobs/payroll-processor';

// ==================== PATCH: Update Scheduled Payroll ====================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, frequency, payDay, isActive } = body as {
      name?: string;
      frequency?: string;
      payDay?: number;
      isActive?: boolean;
    };

    // Check that at least one field is provided
    if (name === undefined && frequency === undefined && payDay === undefined && isActive === undefined) {
      return NextResponse.json(
        { error: 'At least one field must be provided for update' },
        { status: 400 },
      );
    }

    // Fetch existing schedule
    const existing = await db.scheduledPayroll.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Scheduled payroll not found' },
        { status: 404 },
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      updateData.name = name;
    }

    if (frequency !== undefined) {
      const validFrequencies = ['MONTHLY', 'BIWEEKLY', 'WEEKLY'];
      if (!validFrequencies.includes(frequency)) {
        return NextResponse.json(
          { error: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}` },
          { status: 400 },
        );
      }
      updateData.frequency = frequency;
    }

    if (payDay !== undefined) {
      const freq = frequency ?? existing.frequency;
      if (freq === 'MONTHLY' || freq === 'BIWEEKLY') {
        if (payDay < 1 || payDay > 28) {
          return NextResponse.json(
            { error: 'payDay must be between 1 and 28 for monthly/biweekly schedules' },
            { status: 400 },
          );
        }
      } else if (freq === 'WEEKLY') {
        if (payDay < 1 || payDay > 7) {
          return NextResponse.json(
            { error: 'payDay must be between 1 (Monday) and 7 (Sunday) for weekly schedules' },
            { status: 400 },
          );
        }
      }
      updateData.payDay = payDay;
    }

    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    // Recalculate nextRunAt if frequency or payDay changed
    if (frequency !== undefined || payDay !== undefined) {
      const freq = (frequency ?? existing.frequency) as string;
      const day = (payDay ?? existing.payDay) as number;
      updateData.nextRunAt = calculateNextRunDate(freq, day);
    }

    // Perform the update
    const updated = await db.scheduledPayroll.update({
      where: { id },
      data: updateData,
    });

    // Audit log
    await db.auditLog.create({
      data: {
        userId: existing.companyUserId,
        action: 'SCHEDULED_PAYROLL_UPDATE',
        resource: 'ScheduledPayroll',
        details: JSON.stringify({
          scheduleId: id,
          changes: Object.keys(updateData),
          previousValues: {
            name: existing.name,
            frequency: existing.frequency,
            payDay: existing.payDay,
            isActive: existing.isActive,
          },
          newValues: updateData,
        }),
      },
    });

    return NextResponse.json({ schedule: updated });
  } catch (error) {
    console.error('Payroll Schedule PATCH error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
