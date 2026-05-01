import { Response } from 'express';
import { AuthRequest } from '@shared/middleware/auth';
import { payrollService } from './payroll.service';

export const payrollController = {
  async getBalance(req: AuthRequest, res: Response): Promise<void> {
    const balance = await payrollService.getCompanyBalance(req.user!.id);
    res.json({ balance });
  },

  async listEmployees(req: AuthRequest, res: Response): Promise<void> {
    const employees = await payrollService.listEmployees(req.user!.id);
    res.json({ employees });
  },

  async addEmployee(req: AuthRequest, res: Response): Promise<void> {
    const employee = await payrollService.addEmployee(req.user!.id, req.body);
    res.status(201).json({ employeeId: employee.id, message: 'Employee added' });
  },

  async updateEmployee(req: AuthRequest, res: Response): Promise<void> {
    const employee = await payrollService.updateEmployee(req.user!.id, req.params.id, req.body);
    res.json({ employee });
  },

  async removeEmployee(req: AuthRequest, res: Response): Promise<void> {
    await payrollService.removeEmployee(req.user!.id, req.params.id);
    res.status(204).send();
  },

  async schedule(req: AuthRequest, res: Response): Promise<void> {
    const result = await payrollService.schedule({
      companyId: req.user!.id,
      createdBy: req.user!.id,
      employeeIds: req.body.employeeIds,
      amount: req.body.amount,
      date: req.body.date,
    });
    res.status(201).json({ message: 'Payroll scheduled', ...result });
  },

  async report(req: AuthRequest, res: Response): Promise<void> {
    const year = Number(req.query.year);
    const data = await payrollService.report(req.user!.id, year);
    res.json({ year, data });
  },
};
