export type UserRole = 'employee' | 'company';
export type EmployeeStatus = 'PENDING_KYC' | 'ACTIVE' | 'BLOCKED' | 'DEACTIVATED';
export type Plan = 'BASIC' | 'LUXURY';

export interface AuthUser {
  id: string;
  role: UserRole;
  phone?: string;
  email?: string;
  fullName?: string;
  balance?: number;
  plan?: Plan;
  status?: EmployeeStatus;
  companyId?: string | null;
  virtualCardLast4?: string | null;
}
