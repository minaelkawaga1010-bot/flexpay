import { Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { AppError } from '@shared/utils/errors';
import logger from '@shared/utils/logger';
import { prisma } from '@config/prisma';
import { personalisedOffersFor } from './personalization.service';
import { FirewallError } from '@shared/security/prompt-firewall';
import type { PersonalisedOffer } from './offers.types';

/**
 * AI Offers controller — surfaces the Tool-11-firewalled, LLM-ranked
 * offer feed at `/api/v1/ai/offers`.
 *
 * HTTP status mapping for Tool 11 outcomes:
 *
 *   200 — feed returned. Heuristic ranking always fires, so the
 *         user surface never goes empty because the LLM is down.
 *
 *   403 — firewall PLUMBING failure (PII stripper unavailable /
 *         injection classifier unavailable). The mobile client
 *         renders a "service paused" surface.
 *
 *   451 — firewall INPUT rejection (PROMPT_INJECTION_DETECTED).
 *         "Unavailable For Legal Reasons" is the closest IANA-
 *         registered semantic match — the request was refused on
 *         policy, not on identity.
 */

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export class AiOffersController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('employee'));
    this.router.get('/', asyncHandler(this.feed));
    this.router.post('/:offerId/click', asyncHandler(this.click));
  }

  private feed = async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid pagination', parsed.error.flatten());
    }
    const { limit, offset } = parsed.data;

    try {
      const all = await personalisedOffersFor(req.user!.id);
      const slice = all.slice(offset, offset + limit);
      res.json({
        offers: slice,
        pagination: {
          limit,
          offset,
          total: all.length,
          hasMore: offset + limit < all.length,
        },
        firewall: { status: 'OK' },
      });
    } catch (err) {
      if (err instanceof FirewallError) {
        const reason = err.reason;
        const status = reason === 'PROMPT_INJECTION_DETECTED' ? 451 : 403;
        const code =
          reason === 'PROMPT_INJECTION_DETECTED'
            ? 'AI_OFFERS_INJECTION_BLOCKED'
            : reason === 'OUTPUT_SCHEMA_INVALID'
            ? 'AI_OFFERS_OUTPUT_SCHEMA'
            : 'AI_OFFERS_FIREWALL_UNAVAILABLE';
        logger.warn('ai-offers: firewall short-circuit', { reason, code });
        throw new AppError(status, code, firewallMessageFor(reason), { reason });
      }
      throw err;
    }
  };

  private click = async (req: AuthRequest, res: Response): Promise<void> => {
    // Shares the `Offer` rows with the editorial surface; clicks
    // route through `OfferClick` for attribution. Returns the
    // affiliate URL in the JSON body (NOT a 302) so the mobile
    // client opens its own in-app browser.
    const offer = await prisma.offer.findUnique({
      where: { id: req.params.offerId },
    });
    if (!offer || !offer.isActive) {
      throw new AppError(404, 'OFFER_NOT_FOUND', 'Offer not found or inactive');
    }
    await prisma.$transaction([
      prisma.offerClick.create({
        data: {
          offerId: offer.id,
          employeeId: req.user!.id,
          ipAddress: req.ip,
          userAgent: req.header('user-agent') ?? undefined,
        },
      }),
      prisma.offer.update({
        where: { id: offer.id },
        data: { clicks: { increment: 1 } },
      }),
    ]);
    res.json({ affiliateLink: offer.affiliateLink });
  };
}

function firewallMessageFor(reason: FirewallError['reason']): string {
  switch (reason) {
    case 'PROMPT_INJECTION_DETECTED':
      return 'Your request was refused by our safety policy. No personalised offers were generated.';
    case 'PII_STRIPPER_UNAVAILABLE':
    case 'INJECTION_CLASSIFIER_UNAVAILABLE':
      return 'Personalised offers are temporarily paused while our safety service is restored.';
    case 'OUTPUT_SCHEMA_INVALID':
      return 'The personalisation model returned an unexpected response. Falling back to defaults.';
    default:
      return 'Personalised offers are unavailable right now.';
  }
}

export const aiOffersController = new AiOffersController();
export type { PersonalisedOffer };
