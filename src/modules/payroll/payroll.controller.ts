import { Response, Router } from 'express';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { payrollService } from './payroll.service';
import {
  addEmployeeSchema,
  reportQuerySchema,
  schedulePayrollSchema,
  updateEmployeeSchema,
} from './payroll.dto';

export class PayrollController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('company'));
    this.router.get('/balance', asyncHandler(this.getBalance));
    this.router.get('/employees', asyncHandler(this.listEmployees));
    this.router.post(
      '/employees',
      validate(addEmployeeSchema),
      asyncHandler(this.addEmployee),
    );
    this.router.put(
      '/employees/:id',
      validate(updateEmployeeSchema),
      asyncHandler(this.updateEmployee),
    );
    this.router.delete('/employees/:id', asyncHandler(this.removeEmployee));
    this.router.post(
      '/payroll/schedule',
      validate(schedulePayrollSchema),
      asyncHandler(this.schedule),
    );
    this.router.get(
      '/reports/payroll',
      validate(reportQuerySchema, 'query'),
      asyncHandler(this.report),
    );
  }

  private getBalance = async (req: AuthRequest, res: Response): Promise<void> => {
    const balance = await payrollService.getCompanyBalance(req.user!.id);
    res.json({ balance });
  };

  private listEmployees = async (req: AuthRequest, res: Response): Promise<void> => {
    const employees = await payrollService.listEmployees(req.user!.id);
    res.json({ employees });
  };

  private addEmployee = async (req: AuthRequest, res: Response): Promise<void> => {
    const employee = await payrollService.addEmployee(req.user!.id, req.body);
    res.status(201).json({ employeeId: employee.id, message: 'Employee added' });
  };

  private updateEmployee = async (req: AuthRequest, res: Response): Promise<void> => {
    const employee = await payrollService.updateEmployee(req.user!.id, req.params.id, req.body);
    res.json({ employee });
  };

  private removeEmployee = async (req: AuthRequest, res: Response): Promise<void> => {
    await payrollService.removeEmployee(req.user!.id, req.params.id);
    res.status(204).send();
  };

  private schedule = async (req: AuthRequest, res: Response): Promise<void> => {
    const result = await payrollService.schedulePayroll({
      companyId: req.user!.id,
      createdBy: req.user!.id,
      employeeIds: req.body.employeeIds,
      amount: req.body.amount,
      date: req.body.date,
    });
    res.status(201).json({ message: 'Payroll scheduled', ...result });
  };

  private report = async (req: AuthRequest, res: Response): Promise<void> => {
    const year = Number(req.query.year);
    const data = await payrollService.report(req.user!.id, year);
    res.json({ year, data });
  };
}

export const payrollController = new PayrollController();
