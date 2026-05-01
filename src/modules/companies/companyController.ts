import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody, validateQuery } from '../../utils/validation';
import { companyService, payrollService } from './companyService';

const router = Router();

router.use(authenticate, requireRole('company'));

router.get(
  '/balance',
  asyncHandler(async (req, res) => {
    const balance = await companyService.getBalance(req.auth!.sub);
    res.json({ balance });
  }),
);

router.get(
  '/employees',
  asyncHandler(async (req, res) => {
    const employees = await companyService.listEmployees(req.auth!.sub);
    res.json({ employees });
  }),
);

const addEmployeeSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().regex(/^\+\d{8,15}$/),
  email: z.string().email().optional(),
  salary: z.number().nonnegative().optional(),
});

router.post(
  '/employees',
  validateBody(addEmployeeSchema),
  asyncHandler(async (req, res) => {
    const employee = await companyService.addEmployee(req.auth!.sub, req.body);
    res.status(201).json({ employeeId: employee.id, message: 'Employee added' });
  }),
);

const updateEmployeeSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  salary: z.number().nonnegative().optional(),
});

router.put(
  '/employees/:id',
  validateBody(updateEmployeeSchema),
  asyncHandler(async (req, res) => {
    const employee = await companyService.updateEmployee(req.auth!.sub, req.params.id, req.body);
    res.json({ employee });
  }),
);

router.delete(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    await companyService.removeEmployee(req.auth!.sub, req.params.id);
    res.status(204).send();
  }),
);

const scheduleSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1),
  amount: z.number().positive().optional(),
  date: z.coerce.date(),
});

router.post(
  '/payroll/schedule',
  validateBody(scheduleSchema),
  asyncHandler(async (req, res) => {
    const result = await payrollService.schedule({
      companyId: req.auth!.sub,
      employeeIds: req.body.employeeIds,
      amount: req.body.amount,
      date: req.body.date,
    });
    res.status(201).json({ message: 'Payroll scheduled', ...result });
  }),
);

const reportQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

router.get(
  '/reports/payroll',
  validateQuery(reportQuery),
  asyncHandler(async (req, res) => {
    const { year } = req.query as unknown as z.infer<typeof reportQuery>;
    const data = await companyService.payrollReport(req.auth!.sub, year);
    res.json({ year, data });
  }),
);

export default router;
