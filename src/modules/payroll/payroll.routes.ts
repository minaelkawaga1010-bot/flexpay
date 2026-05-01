import { Router } from 'express';
import { authenticate } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import {
  addEmployeeSchema,
  reportQuerySchema,
  schedulePayrollSchema,
  updateEmployeeSchema,
} from './payroll.dto';
import { payrollController } from './payroll.controller';

const router = Router();

router.use(authenticate('company'));

router.get('/balance', asyncHandler(payrollController.getBalance));
router.get('/employees', asyncHandler(payrollController.listEmployees));
router.post('/employees', validate(addEmployeeSchema), asyncHandler(payrollController.addEmployee));
router.put('/employees/:id', validate(updateEmployeeSchema), asyncHandler(payrollController.updateEmployee));
router.delete('/employees/:id', asyncHandler(payrollController.removeEmployee));

router.post(
  '/payroll/schedule',
  validate(schedulePayrollSchema),
  asyncHandler(payrollController.schedule),
);

router.get(
  '/reports/payroll',
  validate(reportQuerySchema, 'query'),
  asyncHandler(payrollController.report),
);

export default router;
