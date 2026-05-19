import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

// ==================== Custom Error Classes ====================

export class FlexPayError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    isOperational = true,
  ) {
    super(message);
    this.name = 'FlexPayError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
  }
}

export class ValidationError extends FlexPayError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends FlexPayError {
  constructor(message = 'Authentication required') {
    super(401, 'AUTHENTICATION_ERROR', message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends FlexPayError {
  constructor(message = 'Insufficient permissions') {
    super(403, 'AUTHORIZATION_ERROR', message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends FlexPayError {
  constructor(resource = 'Resource', id?: string) {
    const message = id ? `${resource} with id "${id}" not found` : `${resource} not found`;
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends FlexPayError {
  constructor(retryAfter?: number) {
    super(
      429,
      'RATE_LIMIT_EXCEEDED',
      'Too many requests. Please try again later.',
      retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : undefined,
    );
    this.name = 'RateLimitError';
  }
}

export class InsufficientFundsError extends FlexPayError {
  constructor(message = 'Insufficient funds to complete this transaction') {
    super(422, 'INSUFFICIENT_FUNDS', message);
    this.name = 'InsufficientFundsError';
  }
}

export class ExternalServiceError extends FlexPayError {
  constructor(service: string, message?: string) {
    super(
      502,
      'EXTERNAL_SERVICE_ERROR',
      message || `External service "${service}" is unavailable`,
      { service },
    );
    this.name = 'ExternalServiceError';
  }
}

// ==================== Prisma Error Mapping ====================

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): FlexPayError {
  switch (error.code) {
    case 'P2002':
      return new ValidationError(
        'A record with this value already exists.',
        { target: error.meta?.target, prismaCode: error.code },
      );
    case 'P2025':
      return new NotFoundError('Record', String(error.meta?.id ?? ''));
    case 'P2003':
      return new ValidationError(
        'Related record not found. Check your foreign key references.',
        { field: error.meta?.field_name, prismaCode: error.code },
      );
    case 'P2014':
      return new ValidationError(
        'Invalid relation change. The relation is not connected.',
        { prismaCode: error.code },
      );
    case 'P2001':
      return new ValidationError(
        'The record you are trying to access does not exist in the database.',
        { prismaCode: error.code },
      );
    case 'P2011':
      return new ValidationError(
        'A required field is missing.',
        { constraint: error.meta?.constraint, prismaCode: error.code },
      );
    case 'P2012':
      return new ValidationError(
        'A required field is missing.',
        { constraint: error.meta?.constraint, prismaCode: error.code },
      );
    case 'P2016':
      return new ValidationError(
        'Query interpretation error. Please check your query parameters.',
        { prismaCode: error.code },
      );
    case 'P2028':
      return new ExternalServiceError(
        'database',
        'Transaction error due to a timeout. Please try again.',
      );
    case 'P2034':
      return new ExternalServiceError(
        'database',
        'Transaction failed due to a concurrent write conflict. Please retry.',
      );
    default:
      return new FlexPayError(
        500,
        'DATABASE_ERROR',
        `A database error occurred (code: ${error.code}).`,
        { prismaCode: error.code },
      );
  }
}

// ==================== Unified Error Response Builder ====================

/**
 * Converts any thrown error into a structured JSON NextResponse.
 *
 * - FlexPayError → structured response with code, message, and details
 * - Prisma known errors → mapped to the appropriate FlexPayError first
 * - Generic Error → 500 with a safe message (stack traces are hidden in production)
 *
 * All errors are logged to console.error with their stack trace.
 */
export function handleError(error: unknown): NextResponse {
  const isProduction = process.env.NODE_ENV === 'production';

  // Already a well-shaped FlexPay error
  if (error instanceof FlexPayError) {
    console.error(`[${error.code}] ${error.message}`, error.stack || '');
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? undefined,
        },
      },
      { status: error.statusCode },
    );
  }

  // Prisma known request errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = mapPrismaError(error);
    console.error(`[${mapped.code}] ${mapped.message}`, mapped.stack || '');
    return NextResponse.json(
      {
        error: {
          code: mapped.code,
          message: mapped.message,
          details: mapped.details ?? undefined,
        },
      },
      { status: mapped.statusCode },
    );
  }

  // Prisma validation errors
  if (error instanceof Prisma.PrismaClientValidationError) {
    console.error('[PRISMA_VALIDATION_ERROR] Query validation failed', error);
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: isProduction
            ? 'Invalid request parameters.'
            : 'Database query validation failed.',
        },
      },
      { status: 400 },
    );
  }

  // Fallback for any other error type
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred';

  console.error('Unhandled error:', error);

  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction
          ? 'An unexpected error occurred. Please try again later.'
          : message,
      },
    },
    { status: 500 },
  );
}

// ==================== Async Handler Wrapper ====================

type AsyncHandler = (
  req: NextRequest,
  ctx?: { params?: Promise<Record<string, string>> },
) => Promise<NextResponse>;

/**
 * Wraps an async route handler so that any thrown error is caught
 * and converted into a proper NextResponse via `handleError`.
 *
 * Usage:
 *   export const GET = withErrorHandler(async (req) => { ... });
 *   export const POST = withErrorHandler(async (req, ctx) => { ... });
 */
export function withErrorHandler(
  handler: AsyncHandler,
): (req: NextRequest, ctx?: { params?: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (
    req: NextRequest,
    ctx?: { params?: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      return handleError(error);
    }
  };
}
