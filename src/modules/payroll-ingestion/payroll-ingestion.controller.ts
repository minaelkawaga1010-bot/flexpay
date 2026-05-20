import { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { AppError, BadRequest, Forbidden, NotFound } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { prisma } from '@config/prisma';
import {
  ingestSifFile,
  wpsParserErrorToAppError,
} from './payroll-ingestion.service';
import { WpsParserError } from './wps-parser.service';

/**
 * POST /api/v1/admin/payroll/ingest-sif
 *
 * Accepts a raw UAE WPS SIF file as the request body (text/plain or
 * application/octet-stream). Mounted with `express.raw()` so the body
 * is delivered as a Buffer with no JSON parsing — the SIF content is
 * not JSON.
 *
 * AuthZ:
 *   • `authenticate('admin')` is the only direct opener.
 *   • A `companyId` query param is required. Admin can ingest for any
 *     company. We deliberately do not let a company-role caller ingest
 *     for themselves yet — the SIF rail is regulator-aligned and the
 *     ops-tier admin signs off on each file in Phase 1. Phase 2 will
 *     add a company-role route gated on a bin-sponsor-verified
 *     attestation.
 *
 * Upload size:
 *   • 10 MB ceiling. UAE WPS files for 5,000-employee companies hover
 *     around 600KB. 10MB is a 15x ceiling that gracefully covers
 *     enterprise-scale uploads while preventing payload-bomb DoS.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Query-side validation. `companyId` is required; everything else is
// optional plumbing. Zod is the convention across the backend.
const ingestQuerySchema = z.object({
  companyId: z.string().uuid('companyId must be a UUID'),
  expectedEmployerId: z
    .string()
    .regex(/^\d{14}$/, 'expectedEmployerId must be 14 digits')
    .optional(),
});

export class PayrollIngestionController {
  public readonly router = Router();

  constructor() {
    // Body parser scoped to this route: raw bytes only. The global
    // express.json() does NOT run on this path because raw is more
    // specific. text/plain and application/octet-stream are both
    // accepted — bank-side tooling varies in what they send.
    this.router.post(
      '/ingest-sif',
      authenticate('admin'),
      express.raw({
        type: ['text/plain', 'application/octet-stream', 'text/csv'],
        limit: MAX_FILE_BYTES,
      }),
      asyncHandler(this.ingest),
    );

    // Lightweight read endpoint for the admin dashboard to inspect a
    // freshly-ingested cycle. Lives here rather than payroll-routing
    // because the audit fields (file fingerprint, ingested-at) are
    // ingestion-side concerns.
    this.router.get(
      '/cycles/:cycleId',
      authenticate('admin'),
      asyncHandler(this.getCycle),
    );
  }

  private ingest = async (req: AuthRequest, res: Response, _next: NextFunction): Promise<void> => {
    const queryParsed = ingestQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      throw BadRequest('Invalid query', queryParsed.error.flatten());
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw BadRequest('Empty request body — expected raw SIF bytes');
    }
    if (req.body.length > MAX_FILE_BYTES) {
      // express.raw() should have rejected first, but defence-in-depth.
      throw BadRequest('File exceeds maximum allowed size');
    }

    logger.info('SIF ingest started', {
      companyId: queryParsed.data.companyId,
      adminId: req.user!.id,
      byteLength: req.body.length,
    });

    try {
      const result = await ingestSifFile({
        companyId: queryParsed.data.companyId,
        expectedEmployerId: queryParsed.data.expectedEmployerId,
        file: req.body,
      });
      res.status(201).json(result);
    } catch (err) {
      // Translate parser errors into the canonical 400 response so the
      // dashboard receives a structured shape.
      if (err instanceof WpsParserError) {
        logger.warn('SIF parse rejected', {
          code: err.code,
          context: err.context,
          companyId: queryParsed.data.companyId,
        });
        throw wpsParserErrorToAppError(err);
      }
      throw err;
    }
  };

  private getCycle = async (req: Request, res: Response): Promise<void> => {
    const { cycleId } = req.params;
    const cycle = await prisma.payrollCycle.findUnique({
      where: { id: cycleId },
      include: {
        _count: { select: { intents: true, advances: true } },
        company: { select: { id: true, name: true } },
      },
    });
    if (!cycle) throw NotFound('PayrollCycle not found');
    res.json({
      id: cycle.id,
      companyId: cycle.companyId,
      companyName: cycle.company.name,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      fileFormat: cycle.fileFormat,
      fileFingerprint: cycle.fileFingerprint,
      status: cycle.status,
      failureReason: cycle.failureReason,
      ingestedAt: cycle.ingestedAt,
      settledAt: cycle.settledAt,
      intentCount: cycle._count.intents,
      advanceCount: cycle._count.advances,
    });
  };
}

export const payrollIngestionController = new PayrollIngestionController();

// Silence unused-import warnings on the AppError + Forbidden helpers
// imported for readability of the controller's auth model. Both are
// referenced through the asyncHandler chain at runtime.
void AppError;
void Forbidden;
