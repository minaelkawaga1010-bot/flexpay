import { z } from 'zod';

export const addEmployeeSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().regex(/^\+\d{8,15}$/),
  email: z.string().email().optional(),
  salary: z.number().nonnegative().optional(),
});
export type AddEmployeeDto = z.infer<typeof addEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  salary: z.number().nonnegative().optional(),
});

export const schedulePayrollSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1),
  amount: z.number().positive().optional(),
  date: z.coerce.date(),
});
export type SchedulePayrollDto = z.infer<typeof schedulePayrollSchema>;

export const reportQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
