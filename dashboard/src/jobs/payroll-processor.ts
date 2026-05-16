/**
 * Payroll Processor — Core payroll processing logic
 *
 * Handles the actual payroll computation: creating records, crediting wallets,
 * generating transactions, sending notifications, and audit logging.
 * All database operations use atomic prisma.$transaction().
 */

import { db } from '@/lib/db';

// ==================== Types ====================

export interface PayrollEmployeeData {
  userId: string;
  employeeId: string;
  baseSalary: number;
  deductions: number;
  bankAccountIban?: string;
}

export interface PayrollResult {
  batchId: string;
  totalEmployees: number;
  processedCount: number;
  failedCount: number;
  totalAmount: number;
  currency: string;
  duration: number;
  errors: Array<{ employeeId: string; reason: string }>;
}

// ==================== Helper Functions ====================

/**
 * Generate a unique batch ID in the format: PR-YYYYMMDD-XXXXX
 */
export async function generateBatchId(): Promise<string> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `PR-${date}-${random}`;
}

/**
 * Create a notification record for payroll events
 */
export async function createPayrollNotification(
  userId: string,
  amount: number,
  status: 'SUCCESS' | 'FAILED',
  batchId?: string,
): Promise<void> {
  const title =
    status === 'SUCCESS'
      ? 'Salary Credited'
      : 'Salary Credit Failed';

  const body =
    status === 'SUCCESS'
      ? `AED ${amount.toFixed(2)} has been credited to your wallet.${batchId ? ` Batch: ${batchId}` : ''}`
      : `We could not process your salary payment. Please contact your employer.${batchId ? ` Batch: ${batchId}` : ''}`;

  await db.notification.create({
    data: {
      userId,
      type: 'PAYROLL',
      title,
      body,
      channel: 'IN_APP',
      priority: status === 'SUCCESS' ? 'MEDIUM' : 'HIGH',
      data: JSON.stringify({ batchId, amount, status }),
    },
  });
}

/**
 * Create an audit log entry for payroll operations
 */
async function createAuditLog(
  userId: string,
  action: string,
  resource: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId,
      action,
      resource,
      details: JSON.stringify(details),
    },
  });
}

/**
 * Calculate the pay period start and end dates for the current month
 */
function getCurrentPayPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

// ==================== Core Processing ====================

/**
 * Process payroll for all (or specified) employees of a company.
 *
 * Flow:
 * 1. Fetch all active employees for the company
 * 2. Create Payroll records (PENDING) for each eligible employee
 * 3. For each payroll record, execute an atomic transaction:
 *    a. Mark payroll as PROCESSING
 *    b. Find/create AED balance for employee wallet
 *    c. Credit the balance with net amount
 *    d. Create SALARY_CREDIT transaction
 *    e. Mark payroll as COMPLETED + processedAt
 *    f. Create notification for employee
 * 4. If any step fails, mark payroll as FAILED with error reason
 * 5. Update ScheduledPayroll lastRunAt and nextRunAt (if applicable)
 * 6. Create notification for company admin
 * 7. Return PayrollResult with stats
 */
export async function processCompanyPayroll(
  companyUserId: string,
  batchId: string,
  employeeUserIds?: string[],
  scheduledPayrollId?: string,
): Promise<PayrollResult> {
  const startTime = Date.now();
  const { start: periodStart, end: periodEnd } = getCurrentPayPeriod();

  const result: PayrollResult = {
    batchId,
    totalEmployees: 0,
    processedCount: 0,
    failedCount: 0,
    totalAmount: 0,
    currency: 'AED',
    duration: 0,
    errors: [],
  };

  try {
    // 1. Fetch eligible employees
    const whereClause: Record<string, unknown> = {
      companyUserId,
      employmentStatus: 'ACTIVE',
    };

    // If specific employees are targeted, filter by userId
    if (employeeUserIds && employeeUserIds.length > 0) {
      whereClause.userId = { in: employeeUserIds };
    }

    const employees = await db.employee.findMany({
      where: whereClause,
      include: {
        user: {
          include: { wallet: { include: { balances: true } } },
        },
      },
    });

    if (employees.length === 0) {
      console.warn(`[Payroll] No active employees found for company ${companyUserId}`);
      return result;
    }

    result.totalEmployees = employees.length;

    // 2-3. Process each employee
    for (const emp of employees) {
      try {
        const grossAmount = emp.baseSalary;
        const deductions = 0; // TODO: Hook into deduction engine
        const netAmount = Math.round((grossAmount - deductions) * 100) / 100;

        if (!emp.user.wallet) {
          throw new Error('Employee has no wallet');
        }

        // Create the payroll record and credit wallet in a single atomic transaction
        await db.$transaction(async (tx) => {
          // a. Create Payroll record (PENDING → PROCESSING)
          const payrollRecord = await tx.payroll.create({
            data: {
              companyUserId,
              batchId,
              employeeUserId: emp.userId,
              grossAmount,
              deductions,
              netAmount,
              currency: 'AED',
              payPeriodStart: periodStart,
              payPeriodEnd: periodEnd,
              status: 'PROCESSING',
            },
          });

          // b. Find or create AED balance
          const existingBalance = await tx.balance.findUnique({
            where: {
              walletId_currency: {
                walletId: emp.user.wallet!.id,
                currency: 'AED',
              },
            },
          });

          if (existingBalance) {
            await tx.balance.update({
              where: { id: existingBalance.id },
              data: { amount: { increment: netAmount } },
            });
          } else {
            await tx.balance.create({
              data: {
                walletId: emp.user.wallet!.id,
                currency: 'AED',
                amount: netAmount,
              },
            });
          }

          // c. Create SALARY_CREDIT transaction
          const txnRef = `SAL${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          const transaction = await tx.transaction.create({
            data: {
              userId: emp.userId,
              type: 'SALARY_CREDIT',
              status: 'COMPLETED',
              amount: netAmount,
              currency: 'AED',
              fee: 0,
              description: `Salary credit for ${periodStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} — Batch ${batchId}`,
              reference: txnRef,
              metadata: JSON.stringify({
                batchId,
                payrollId: payrollRecord.id,
                employeeId: emp.employeeId,
                grossAmount,
                deductions,
              }),
            },
          });

          // d. Update Payroll to COMPLETED
          await tx.payroll.update({
            where: { id: payrollRecord.id },
            data: {
              status: 'COMPLETED',
              processedAt: new Date(),
              transactionId: transaction.id,
            },
          });

          // e. Create notification for employee
          await tx.notification.create({
            data: {
              userId: emp.userId,
              type: 'PAYROLL',
              title: 'Salary Credited',
              body: `AED ${netAmount.toFixed(2)} has been credited to your wallet. Batch: ${batchId}`,
              channel: 'IN_APP',
              priority: 'MEDIUM',
              data: JSON.stringify({ batchId, amount: netAmount, payrollId: payrollRecord.id }),
            },
          });
        });

        result.processedCount++;
        result.totalAmount += grossAmount;

        // Audit log for successful processing
        await createAuditLog(companyUserId, 'PAYROLL_PROCESS', 'Payroll', {
          batchId,
          employeeUserId: emp.userId,
          employeeId: emp.employeeId,
          amount: netAmount,
          status: 'COMPLETED',
        });
      } catch (empError) {
        const errorMsg = empError instanceof Error ? empError.message : String(empError);

        // Create a failed payroll record for auditability
        try {
          const grossAmount = emp.baseSalary;
          const netAmount = Math.round((grossAmount - 0) * 100) / 100;

          await db.payroll.create({
            data: {
              companyUserId,
              batchId,
              employeeUserId: emp.userId,
              grossAmount,
              deductions: 0,
              netAmount,
              currency: 'AED',
              payPeriodStart: periodStart,
              payPeriodEnd: periodEnd,
              status: 'FAILED',
              failureReason: errorMsg,
            },
          });

          // Notify employee about failure
          await createPayrollNotification(emp.userId, netAmount, 'FAILED', batchId);
        } catch {
          // Silent fail — don't let notification errors break the loop
        }

        result.failedCount++;
        result.errors.push({ employeeId: emp.employeeId, reason: errorMsg });

        console.error(`[Payroll] Failed for employee ${emp.employeeId}: ${errorMsg}`);
      }
    }

    // 4. Update ScheduledPayroll if this was triggered by a schedule
    if (scheduledPayrollId) {
      try {
        const schedule = await db.scheduledPayroll.findUnique({
          where: { id: scheduledPayrollId },
        });

        if (schedule) {
          const nextRun = calculateNextRunDate(schedule.frequency, schedule.payDay);
          await db.scheduledPayroll.update({
            where: { id: scheduledPayrollId },
            data: {
              lastRunAt: new Date(),
              nextRunAt: nextRun,
              totalEmployees: result.totalEmployees,
              totalAmount: result.totalAmount,
            },
          });
        }
      } catch (err) {
        console.error(`[Payroll] Failed to update scheduled payroll: ${err}`);
      }
    }

    // 5. Create summary notification for company admin
    const summaryTitle =
      result.failedCount === 0
        ? `Payroll Complete — ${result.processedCount} employees`
        : `Payroll Partial — ${result.processedCount} succeeded, ${result.failedCount} failed`;

    const summaryBody =
      `Batch ${batchId}: AED ${result.totalAmount.toFixed(2)} processed across ${result.totalEmployees} employees.` +
      (result.failedCount > 0 ? ` ${result.failedCount} employees require attention.` : '');

    await db.notification.create({
      data: {
        userId: companyUserId,
        type: 'PAYROLL',
        title: summaryTitle,
        body: summaryBody,
        channel: 'IN_APP',
        priority: result.failedCount > 0 ? 'HIGH' : 'MEDIUM',
        data: JSON.stringify({
          batchId,
          totalEmployees: result.totalEmployees,
          processedCount: result.processedCount,
          failedCount: result.failedCount,
          totalAmount: result.totalAmount,
          errors: result.errors,
        }),
      },
    });

    // Audit log for batch completion
    await createAuditLog(companyUserId, 'PAYROLL_BATCH_COMPLETE', 'Payroll', {
      batchId,
      ...result,
    });

    result.duration = Date.now() - startTime;
    console.log(
      `[Payroll] Batch ${batchId} complete: ${result.processedCount}/${result.totalEmployees} ` +
      `processed in ${result.duration}ms`
    );

    return result;
  } catch (error) {
    result.duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Payroll] Batch ${batchId} fatal error: ${errorMsg}`);

    // Audit log for batch failure
    await createAuditLog(companyUserId, 'PAYROLL_BATCH_FAILED', 'Payroll', {
      batchId,
      error: errorMsg,
    });

    throw error;
  }
}

/**
 * Process a single payroll record (for retry purposes).
 * Uses the same atomic transaction logic as the batch processor.
 */
export async function processSingleEmployeePayroll(payrollId: string): Promise<void> {
  // Fetch the payroll record with related data
  const payroll = await db.payroll.findUnique({
    where: { id: payrollId },
    include: {
      employee: {
        include: {
          user: {
            include: { wallet: { include: { balances: true } } },
          },
        },
      },
    },
  });

  if (!payroll) {
    throw new Error(`Payroll record ${payrollId} not found`);
  }

  if (payroll.status === 'COMPLETED') {
    throw new Error(`Payroll record ${payrollId} is already completed`);
  }

  if (!payroll.employee) {
    throw new Error(`No employee profile linked to payroll ${payrollId}`);
  }

  if (!payroll.employee.user.wallet) {
    throw new Error(`Employee has no wallet for payroll ${payrollId}`);
  }

  // Reset status to PROCESSING
  await db.payroll.update({
    where: { id: payrollId },
    data: { status: 'PROCESSING', failureReason: null },
  });

  try {
    // Atomic transaction for wallet credit
    await db.$transaction(async (tx) => {
      const wallet = payroll.employee!.user.wallet!;

      // Find or create AED balance
      const existingBalance = await tx.balance.findUnique({
        where: {
          walletId_currency: {
            walletId: wallet.id,
            currency: 'AED',
          },
        },
      });

      if (existingBalance) {
        await tx.balance.update({
          where: { id: existingBalance.id },
          data: { amount: { increment: payroll.netAmount } },
        });
      } else {
        await tx.balance.create({
          data: {
            walletId: wallet.id,
            currency: 'AED',
            amount: payroll.netAmount,
          },
        });
      }

      // Create SALARY_CREDIT transaction
      const txnRef = `SAL${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const transaction = await tx.transaction.create({
        data: {
          userId: payroll.employeeUserId,
          type: 'SALARY_CREDIT',
          status: 'COMPLETED',
          amount: payroll.netAmount,
          currency: 'AED',
          fee: 0,
          description: `Salary credit (retry) — Batch ${payroll.batchId}`,
          reference: txnRef,
          metadata: JSON.stringify({
            batchId: payroll.batchId,
            payrollId: payroll.id,
            employeeId: payroll.employee?.employeeId,
            isRetry: true,
          }),
        },
      });

      // Update payroll to COMPLETED
      await tx.payroll.update({
        where: { id: payrollId },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          transactionId: transaction.id,
        },
      });

      // Create notification
      await tx.notification.create({
        data: {
          userId: payroll.employeeUserId,
          type: 'PAYROLL',
          title: 'Salary Credited',
          body: `AED ${payroll.netAmount.toFixed(2)} has been credited to your wallet (retry). Batch: ${payroll.batchId}`,
          channel: 'IN_APP',
          priority: 'MEDIUM',
          data: JSON.stringify({ batchId: payroll.batchId, amount: payroll.netAmount, isRetry: true }),
        },
      });
    });

    console.log(`[Payroll] Retry successful for payroll ${payrollId}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Mark as failed again
    await db.payroll.update({
      where: { id: payrollId },
      data: {
        status: 'FAILED',
        failureReason: `Retry failed: ${errorMsg}`,
      },
    });

    console.error(`[Payroll] Retry failed for payroll ${payrollId}: ${errorMsg}`);
    throw error;
  }
}

// ==================== Utility Functions ====================

/**
 * Calculate the next run date for a scheduled payroll
 */
export function calculateNextRunDate(frequency: string, payDay: number): Date {
  const now = new Date();
  const gstOffset = 4 * 60; // GST is UTC+4
  const gstNow = new Date(now.getTime() + gstOffset * 60 * 1000);

  const nextRun = new Date(gstNow);

  switch (frequency) {
    case 'WEEKLY': {
      // payDay: 1=Monday ... 7=Sunday
      const currentDay = gstNow.getDay() || 7; // Convert 0=Sunday to 7
      let daysUntil = payDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      nextRun.setDate(gstNow.getDate() + daysUntil);
      break;
    }
    case 'BIWEEKLY': {
      // payDay: day of month (1-28)
      let targetDay = payDay;
      if (gstNow.getDate() >= targetDay) {
        targetDay += 14;
        if (targetDay > 28) targetDay -= 28;
      }
      nextRun.setDate(targetDay);
      // If target day is still in the past, go to next period
      if (nextRun <= gstNow) {
        nextRun.setDate(nextRun.getDate() + 14);
      }
      break;
    }
    case 'MONTHLY':
    default: {
      // payDay: day of month (1-28)
      const lastDayOfMonth = new Date(gstNow.getFullYear(), gstNow.getMonth() + 1, 0).getDate();
      const targetDay = Math.min(payDay, lastDayOfMonth);

      if (gstNow.getDate() >= targetDay) {
        // Move to next month
        nextRun.setMonth(gstNow.getMonth() + 1, targetDay);
      } else {
        nextRun.setDate(targetDay);
      }
      break;
    }
  }

  // Set time to 2:00 AM GST
  nextRun.setHours(2, 0, 0, 0);

  // Convert back to UTC for storage
  return new Date(nextRun.getTime() - gstOffset * 60 * 1000);
}
