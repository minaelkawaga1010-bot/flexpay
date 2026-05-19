import { Response, Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '@shared/middleware/auth';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import { metricsService, DEFAULT_WINDOW_DAYS } from './metrics.service';
import { liquidityForecasterService } from './liquidity-forecaster.service';
import { fraudMonitorService } from './fraud-monitor.service';

/**
 * Admin operational-intelligence surface. All routes:
 *   • require role=admin (verified against the JWT + DB account state)
 *   • are NOT cached at the gateway — these are live snapshots
 *   • return the raw service shapes; the dashboard transforms client-
 *     side. Keeping the API stable across UI iterations is the goal.
 */

const metricsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
});

export class ReportsController {
  public readonly router = Router();

  constructor() {
    this.router.use(authenticate('admin'));

    // Board-deck primary KPIs.
    this.router.get(
      '/metrics',
      validate(metricsQuerySchema, 'query'),
      asyncHandler(this.getMetrics),
    );

    // Treasury 7/15/30-day liquidity runway.
    this.router.get('/liquidity', asyncHandler(this.getLiquidity));

    // On-demand fraud scan (the cron runs every 15 min; this is the
    // "give me the current picture" admin trigger).
    this.router.post('/fraud-scan', asyncHandler(this.runFraudScan));
  }

  private getMetrics = async (req: AuthRequest, res: Response): Promise<void> => {
    const { windowDays } = req.query as { windowDays?: string };
    const window = windowDays ? Number(windowDays) : DEFAULT_WINDOW_DAYS;
    const metrics = await metricsService.compile(window);
    res.json(metrics);
  };

  private getLiquidity = async (_req: AuthRequest, res: Response): Promise<void> => {
    const forecast = await liquidityForecasterService.forecast();
    res.json(forecast);
  };

  private runFraudScan = async (_req: AuthRequest, res: Response): Promise<void> => {
    const result = await fraudMonitorService.scan();
    res.json(result);
  };
}

export const reportsController = new ReportsController();
