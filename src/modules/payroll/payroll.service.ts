import { Prisma } from '@prisma/client';
import { prisma } from '@config/prisma';
import { BadRequest, Conflict, Forbidden, NotFound } from '@shared/utils/errors';
import { generateReferralCode } from '@shared/utils/referralCode';
import { twilioService } from '@modules/auth/twilio.service';
import { cardsService } from '@modules/cards/cards.service';
import { notificationService } from '@modules/notifications/notification.service';
import { AddEmployeeDto, SchedulePayrollDto } from './payroll.dto';

type AmountMap = Record<string, number>;

export const payrollService = {
  // ----------------------------------------------------------- Company ops

  async getCompanyBalance(companyId: string): Promise<number> {
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
        status: 'PENDING_KYC',
      },
    });

    try {
      await cardsService.issueVirtualCard(employee.id);
      await prisma.employee.update({ where: { id: employee.id }, data: { status: 'ACTIVE' } });
    } catch {
      // status stays PENDING_KYC; can be retried by the user later
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
    await prisma.employee.update({ where: { id: employeeId }, data: { companyId: null } });
  },

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
  },

  // ------------------------------------------------------------- Schedule

  async schedule(input: { companyId: string; createdBy: string } & SchedulePayrollDto) {
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
      const amt = input.amount ?? e.salary ?? 0;
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
        createdBy: input.createdBy,
      },
    });

    return { id: payroll.id, totalAmount };
  },

  // ------------------------------------------------------------ Processor

  async processDuePayrolls(now: Date = new Date()) {
    const due = await prisma.scheduledPayroll.findMany({
      where: { status: 'PENDING', scheduledDate: { lte: now } },
    });

    const results: { id: string; status: 'COMPLETED' | 'FAILED'; reason?: string }[] = [];

    for (const payroll of due) {
      try {
        await prisma.scheduledPayroll.update({
          where: { id: payroll.id },
          data: { status: 'PROCESSING' },
        });

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const company = await tx.company.findUnique({ where: { id: payroll.companyId } });
          if (!company) throw new Error('Company not found');
          if (company.balance < payroll.totalAmount) throw new Error('Insufficient company balance');

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
                payrollId: payroll.id,
              },
            });
          }

          await tx.scheduledPayroll.update({
            where: { id: payroll.id },
            data: { status: 'COMPLETED', processedAt: new Date() },
          });
        });

        for (const employeeId of payroll.employeeIds) {
          const amt = (payroll.amountPerEmployee as AmountMap)[employeeId];
          await notificationService.notifySalaryCredited(employeeId, amt);
        }

        results.push({ id: payroll.id, status: 'COMPLETED' });
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
