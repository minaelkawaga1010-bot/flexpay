export type UserRole = 'employee' | 'company' | 'admin';

export interface PaginationQuery {
  limit: number;
  offset: number;
}

export interface ErrorResponse {
  error: string;
  message?: string;
  details?: unknown;
}
