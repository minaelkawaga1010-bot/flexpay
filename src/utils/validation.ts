import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { BadRequest } from './errors';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(BadRequest('Invalid request body', result.error.flatten()));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(BadRequest('Invalid query parameters', result.error.flatten()));
    }
    Object.assign(req.query, result.data);
    next();
  };
}
