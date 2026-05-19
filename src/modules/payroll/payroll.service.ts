import { Prisma, EmployeeStatus } from '@prisma/client';
import { prisma } from '@config/prisma';
import { BadRequest, Conflict, Forbidden, NotFound } from '@shared/utils/errors';
import { generateReferralCode } from '@shared/utils/referralCode';
import logger from '@shared/utils/logger';
import { twilioService } from '@modules/auth/twilio.service';
import { cardsService } from '@modules/cards/cards.service';
import { enqueueNotification } from '@modules/notifications/notification.job';
import { AddEmployeeDto, SchedulePayrollDto } from './payroll.dto';
import { enqueuePayrollJob } from './payroll.job';

type AmountMap = Record<string, number>;

export class PayrollService {
  // ----------------------------------------------------------- Company ops

  async getCompanyBalance(companyId: string): Promise<number> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { balance: true },
    });
    if (!company) throw NotFound('Company not found');
    return company.balance;
  }

  async listEmployees(companyId: string) {
    return prisma.employee.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        salary: true,
        walletBalance: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async addEmployee(companyId: string, input: AddEmployeeDto) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw NotFound('Company not found');

    const existing = await prisma.employee.findUnique({ where: { phone: input.phone } });
    if (existing) throw Conflict('Employee with this phone already exists');

    const employee = await prisma.employee.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        salary: input.salary,
        companyId,
        referralCode: generateReferralCode(),
        status: EmployeeStatus.PENDING_KYC,
      },
    });

    try {
      await cardsService.issueVirtualCard(employee.id);
      await prisma.employee.update({
        where: { id: employee.id },
        data: { status: EmployeeStatus.ACTIVE },
      });
    } catch {
      // status stays PENDING_KYC; can be retried by the user later
    }

    await twilioService.sendWelcomeSMS(employee.phone);
    return employee;
  }

  async updateEmployee(
    companyId: string,
    employeeId: string,
    patch: { fullName?: string; salary?: number; email?: string },
  ) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('Employee not found');
    if (employee.companyId !== companyId) {
      throw Forbidden('Employee does not belong to this company');
    }
    return prisma.employee.update({ where: { id: employeeId }, data: patch });
  }

  async removeEmployee(companyId: string, employeeId: string) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('Employee not found');
    if (employee.companyId !== companyId) {
      throw Forbidden('Employee does not belong to this company');
    }
    await prisma.employee.update({ where: { id: employeeId }, data: { companyId: null } });
  }

  async report(companyId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const rows = await prisma.scheduledPayroll.findMany({
      where: { companyId, status: 'COMPLETED', scheduledDate: { gte: start, lt: end } },
      select: { totalAmount: true, scheduledDate: true },
    });
    const buckets: Record<number, number> = {};
    for (const r of rows) {
      const m = r.scheduledDate.getUTCMonth() + 1;
      buckets[m] = (buckets[m] ?? 0) + r.totalAmount;
    }
    return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: buckets[i + 1] ?? 0 }));
  }

  // -------------------------------------------------------------- Schedule

  async schedulePayroll(input: { companyId: string; createdBy: string } & SchedulePayrollDto) {
    if (!input.employeeIds.length) throw BadRequest('At least one employee is required');

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const company = await tx.company.findFirst({
        where: { id: input.companyId, status: 'ACTIVE' },
      });
      if (!company) throw NotFound('COMPANY_NOT_FOUND');

      const employees = await tx.employee.findMany({
        where: { id: { in: input.employeeIds }, companyId: input.companyId, status: 'ACTIVE' },
        select: { id: true, salary: true },
      });
      if (employees.length !== input.employeeIds.length) {
        throw BadRequest('INVALID_EMPLOYEE_SELECTION');
      }

      const amountPerEmployee: AmountMap = {};
      let totalAmount = 0;
      for (const e of employees) {
        const amt = input.amount ?? e.salary ?? 0;
        if (amt <= 0) throw BadRequest(`Employee ${e.id} has no salary configured`);
        amountPerEmployee[e.id] = amt;
        totalAmount += amt;
      }

      if (company.balance < totalAmount) {
        throw BadRequest(
          `INSUFFICIENT_COMPANY_BALANCE: required AED ${totalAmount}, available AED ${company.balance}`,
        );
      }

      const payroll = await tx.scheduledPayroll.create({
        data: {
          companyId: input.companyId,
          employeeIds: input.employeeIds,
          amountPerEmployee: amountPerEmployee as Prisma.InputJsonValue,
          totalAmount,
          scheduledDate: input.date,
          createdBy: input.createdBy,
        },
      });

      return { payroll, totalAmount };
    });

    // Schedule the Bull job *outside* the DB transaction. If the queue
    // enqueue fails, the daily cron sweep will still pick the row up.
    const delayMs = Math.max(0, input.date.getTime() - Date.now());
    await enqueuePayrollJob(result.payroll.id, delayMs);

    return { payrollId: result.payroll.id, totalAmount: result.totalAmount };
  }

  // ------------------------------------------------------------- Process

  /** Process a single payroll by id (called from the Bull worker). */
  async processPayroll(payrollId: string) {
    const payroll = await prisma.scheduledPayroll.findUnique({
      where: { id: payrollId },
      include: { company: true },
    });

    if (!payroll || payroll.status === 'COMPLETED') return { success: true, processedCount: 0 };
    if (payroll.status === 'PROCESSING') {
      logger.warn('payroll already processing, skipping', { payrollId });
      return { success: false, reason: 'IN_PROGRESS' };
    }

    await prisma.scheduledPayroll.update({
      where: { id: payrollId },
      data: { status: 'PROCESSING' },
    });

    try {
      const amounts = payroll.amountPerEmployee as AmountMap;

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.company.update({
          where: { id: payroll.companyId },
          data: { balance: { decrement: payroll.totalAmount } },
        });

        for (const employeeId of payroll.employeeIds) {
          const amt = amounts[employeeId];
          await tx.employee.update({
            where: { id: employeeId },
            data: { walletBalance: { increment: amt } },
          });
          await tx.employeeTransaction.create({
            data: {
              employeeId,
              type: 'PAYROLL',
              amount: amt,
              totalAmount: amt,
              status: 'COMPLETED',
              description: `Salary - ${payroll.company.name}`,
              reference: `payroll:${payroll.id}`,
              payrollId: payroll.id,
            },
          });
        }

        await tx.scheduledPayroll.update({
          where: { id: payrollId },
          data: { status: 'COMPLETED', processedAt: new Date() },
        });
      });

      // Side-effects after commit
      for (const employeeId of payroll.employeeIds) {
        await enqueueNotification({
          kind: 'salary-credited',
          employeeId,
          amount: amounts[employeeId],
          companyName: payroll.company.name,
        });
      }

      return { success: true, processedCount: payroll.employeeIds.length };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      await prisma.scheduledPayroll.update({
        where: { id: payrollId },
        data: { status: 'FAILED', failureReason: reason },
      });
      throw err;
    }
  }

  /** Cron sweep: pick up any PENDING payrolls past their scheduled date. */
  async processDuePayrolls(now: Date = new Date()) {
    const due = await prisma.scheduledPayroll.findMany({
      where: { status: 'PENDING', scheduledDate: { lte: now } },
      select: { id: true },
    });

    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const { id } of due) {
      try {
        await this.processPayroll(id);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'unknown' });
      }
    }
    return results;
  }
}

export const payrollService = new PayrollService();
