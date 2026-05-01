import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../utils/errors';
import { generateReferralCode } from '../../utils/referral';
import { twilioService } from '../../services/twilioService';
import { cardService } from '../cards/cardService';

export const companyService = {
  async getBalance(companyId: string): Promise<number> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { balance: true },
    });
    if (!company) throw NotFound('Company not found');
    return company.balance;
  },

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
  },

  async addEmployee(
    companyId: string,
    input: { fullName: string; phone: string; email?: string; salary?: number },
  ) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw NotFound('Company not found');

    const existing = await prisma.employee.findUnique({ where: { phone: input.phone } });
    if (existing) throw Conflict('Employee with this phone already exists');

    const employee = await prisma.employee.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        salary: input.salary ?? 0,
        companyId,
        referralCode: generateReferralCode(),
        status: 'PENDING_KYC',
      },
    });

    try {
      await cardService.issueVirtualCard(employee.id);
      await prisma.employee.update({ where: { id: employee.id }, data: { status: 'ACTIVE' } });
    } catch {
      /* keep status PENDING_KYC; card can be retried */
    }

    await twilioService.sendSms(
      employee.phone,
      'Welcome to FlexPay! Download the app to access your wallet: https://flexpay.ae/download',
    );

    return employee;
  },

  async updateEmployee(
    companyId: string,
    employeeId: string,
    patch: { fullName?: string; salary?: number; email?: string },
  ) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('Employee not found');
    if (employee.companyId !== companyId) throw Forbidden('Employee does not belong to this company');
    return prisma.employee.update({ where: { id: employeeId }, data: patch });
  },

  async removeEmployee(companyId: string, employeeId: string) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('Employee not found');
    if (employee.companyId !== companyId) throw Forbidden('Employee does not belong to this company');
    await prisma.employee.update({
      where: { id: employeeId },
      data: { companyId: null },
    });
  },

  /**
   * Aggregate payroll spend per month for the given year (1-12 -> total amount).
   */
  async payrollReport(companyId: string, year: number) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const rows = await prisma.scheduledPayroll.findMany({
      where: {
        companyId,
        status: 'PROCESSED',
        scheduledDate: { gte: start, lt: end },
      },
      select: { totalAmount: true, scheduledDate: true },
    });
    const buckets: Record<number, number> = {};
    for (const r of rows) {
      const m = r.scheduledDate.getUTCMonth() + 1;
      buckets[m] = (buckets[m] ?? 0) + r.totalAmount;
    }
    return Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      total: buckets[i + 1] ?? 0,
    }));
  },
};

export type AmountMap = Record<string, number>;

export const payrollService = {
  async schedule(input: {
    companyId: string;
    employeeIds: string[];
    amount?: number;
    date: Date;
  }) {
    if (!input.employeeIds.length) throw BadRequest('At least one employee is required');
    const company = await prisma.company.findUnique({ where: { id: input.companyId } });
    if (!company) throw NotFound('Company not found');

    const employees = await prisma.employee.findMany({
      where: { id: { in: input.employeeIds }, companyId: input.companyId },
      select: { id: true, salary: true },
    });
    if (employees.length !== input.employeeIds.length) {
      throw BadRequest('One or more employees do not belong to this company');
    }

    const amountPerEmployee: AmountMap = {};
    let totalAmount = 0;
    for (const e of employees) {
      const amt = input.amount ?? e.salary;
      if (amt <= 0) throw BadRequest(`Employee ${e.id} has no salary configured`);
      amountPerEmployee[e.id] = amt;
      totalAmount += amt;
    }

    if (company.balance < totalAmount) {
      throw BadRequest(
        `Insufficient company balance: required AED ${totalAmount}, available AED ${company.balance}`,
      );
    }

    const payroll = await prisma.scheduledPayroll.create({
      data: {
        companyId: input.companyId,
        employeeIds: input.employeeIds,
        amountPerEmployee: amountPerEmployee as Prisma.InputJsonValue,
        totalAmount,
        scheduledDate: input.date,
      },
    });

    return { id: payroll.id, totalAmount };
  },

  /**
   * Process all PENDING payrolls whose scheduledDate is at or before `now`.
   * Each payroll runs in its own DB transaction (atomic per company).
   */
  async processDuePayrolls(now: Date = new Date()) {
    const due = await prisma.scheduledPayroll.findMany({
      where: { status: 'PENDING', scheduledDate: { lte: now } },
    });

    const results: { id: string; status: 'PROCESSED' | 'FAILED'; reason?: string }[] = [];

    for (const payroll of due) {
      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const company = await tx.company.findUnique({ where: { id: payroll.companyId } });
          if (!company) throw new Error('Company not found');
          if (company.balance < payroll.totalAmount) {
            throw new Error('Insufficient company balance');
          }

          await tx.company.update({
            where: { id: payroll.companyId },
            data: { balance: { decrement: payroll.totalAmount } },
          });

          const amounts = payroll.amountPerEmployee as AmountMap;
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
                description: 'Salary credit',
                reference: payroll.id,
              },
            });
          }

          await tx.scheduledPayroll.update({
            where: { id: payroll.id },
            data: { status: 'PROCESSED', processedAt: new Date() },
          });
        });

        results.push({ id: payroll.id, status: 'PROCESSED' });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown';
        await prisma.scheduledPayroll.update({
          where: { id: payroll.id },
          data: { status: 'FAILED', failureReason: reason },
        });
        results.push({ id: payroll.id, status: 'FAILED', reason });
      }
    }

    return results;
  },
};
