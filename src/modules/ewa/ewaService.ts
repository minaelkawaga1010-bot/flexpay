import { prisma } from '../../config/db';
import { flexxPayService } from '../../services/flexxPayService';
import { BadRequest, NotFound } from '../../utils/errors';
import { creditScoreService } from '../scoring/creditScoreService';

const MIN_SCORE_FOR_EWA = 60;

export const ewaService = {
  async requestAdvance(employeeId: string, amount: number, returnUrl: string) {
    if (amount <= 0) throw BadRequest('Amount must be positive');
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw NotFound('Employee not found');

    const score = await creditScoreService.compute(employeeId);
    if (score.score < MIN_SCORE_FOR_EWA) {
      throw BadRequest(`Credit score ${score.score} is below the minimum (${MIN_SCORE_FOR_EWA})`);
    }
    if (amount > score.maxEWAAmount) {
      throw BadRequest(`Requested amount exceeds your limit of AED ${score.maxEWAAmount}`);
    }

    const redirectUrl = await flexxPayService.createAdvanceRequest({
      employeeName: employee.fullName,
      employeePhone: employee.phone,
      amount,
      employerId: employee.companyId,
      returnUrl,
    });

    const loan = await prisma.loan.create({
      data: { employeeId, amount, status: 'PENDING', externalRef: redirectUrl },
    });

    return { redirectUrl, loanId: loan.id };
  },
};
