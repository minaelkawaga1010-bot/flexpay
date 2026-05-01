import { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../config/logger';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
};

export const notFoundHandler = (_req: import('express').Request, res: import('express').Response): void => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};
