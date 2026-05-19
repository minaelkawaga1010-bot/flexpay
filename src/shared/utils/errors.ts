export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const BadRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);
export const Unauthorized = (msg = 'Unauthorized') => new AppError(401, 'UNAUTHORIZED', msg);
export const Forbidden = (msg = 'Forbidden') => new AppError(403, 'FORBIDDEN', msg);
export const NotFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const Conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
