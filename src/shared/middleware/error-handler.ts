import { ErrorRequestHandler, Request, Response } from 'express';
import { AppError } from '@shared/utils/errors';
import logger from '@shared/utils/logger';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }
  logger.error('Unhandled error', { error: (err as Error).message, stack: (err as Error).stack });
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' });
};
