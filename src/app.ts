import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { env, isProd, isTest } from '@config/env';
import { checkDatabaseHealth } from '@config/prisma';
import { checkQueueHealth } from '@config/bull';
import { errorHandler, notFoundHandler } from '@shared/middleware/error-handler';
import { apiRateLimiter } from '@shared/middleware/rate-limit';

// Controllers
import { authController } from '@modules/auth/auth.controller';
import { payrollController } from '@modules/payroll/payroll.controller';
import { walletController } from '@modules/wallet/wallet.controller';
import { cardsController } from '@modules/cards/cards.controller';
import { offersController } from '@modules/offers/offers.controller';
import { savingsController } from '@modules/savings/savings.controller';
import { scoringController } from '@modules/scoring/scoring.controller';
import { ewaController } from '@modules/ewa/ewa.controller';
import { remittanceController } from '@modules/remittance/remittance.controller';
import { referralsController } from '@modules/referrals/referrals.controller';
import { notificationsController } from '@modules/notifications/notification.controller';
import { mobileWalletController } from '@modules/mobile-api/wallet.controller';
import { reportsController } from '@modules/ops-intel/reports.controller';

// Webhooks
import { nymcardWebhook } from '@webhooks/nymcard.webhook';
import { moneyhashWebhook } from '@webhooks/moneyhash.webhook';
import { flexxpayWebhook } from '@webhooks/flexxpay.webhook';

export const app = express();

app.disable('x-powered-by');

// =====================================================================
// Security
// =====================================================================

app.use(
  helmet({
    contentSecurityPolicy: isProd ? undefined : false,
  }),
);

app.use(
  cors({
    origin: isProd ? ['https://flexpay.ae', 'https://dashboard.flexpay.ae'] : true,
    credentials: true,
  }),
);

// =====================================================================
// Webhooks — mounted BEFORE express.json() so raw bodies survive for
// HMAC signature verification.
// =====================================================================

app.use('/webhooks/nymcard', express.raw({ type: 'application/json', limit: '1mb' }), nymcardWebhook.router);
app.use('/webhooks/moneyhash', express.raw({ type: 'application/json', limit: '1mb' }), moneyhashWebhook.router);
app.use('/webhooks/flexxpay', express.raw({ type: 'application/json', limit: '1mb' }), flexxpayWebhook.router);

// =====================================================================
// Body parsing + logging + compression
// =====================================================================

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(compression());
if (!isTest) app.use(morgan(isProd ? 'combined' : 'dev'));

// =====================================================================
// Health
// =====================================================================

app.get('/health', async (_req: Request, res: Response) => {
  const [dbHealthy, queues] = await Promise.all([checkDatabaseHealth(), checkQueueHealth()]);
  const allQueuesHealthy = Object.values(queues).every(Boolean);
  const ok = dbHealthy && allQueuesHealthy;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'healthy' : 'degraded',
    service: env.APP_NAME,
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    services: { database: dbHealthy, queues },
  });
});

// =====================================================================
// API surface
// =====================================================================

app.use(env.API_PREFIX, apiRateLimiter);

app.use(`${env.API_PREFIX}/auth`, authController.router);
app.use(`${env.API_PREFIX}/wallet`, walletController.router);
app.use(`${env.API_PREFIX}/companies`, payrollController.router);
app.use(`${env.API_PREFIX}/cards`, cardsController.router);
app.use(`${env.API_PREFIX}/offers`, offersController.router);
app.use(`${env.API_PREFIX}/savings`, savingsController.router);
app.use(`${env.API_PREFIX}/credit`, scoringController.router);
app.use(`${env.API_PREFIX}/ewa`, ewaController.router);
app.use(`${env.API_PREFIX}/remittance`, remittanceController.router);
app.use(`${env.API_PREFIX}/referrals`, referralsController.router);
app.use(`${env.API_PREFIX}/notifications`, notificationsController.router);
// Mobile API gateway — device-bound, biometric-attested, step-up-OTP-
// gated wallet surface. See src/modules/mobile-api/ for the security
// stack. The legacy /wallet/* surface remains for service-to-service
// callers; mobile clients target /mobile/wallet/* exclusively.
app.use(`${env.API_PREFIX}/mobile/wallet`, mobileWalletController.router);
// Admin ops-intel surface — board-deck metrics, treasury liquidity
// forecast, on-demand fraud scan. Gated on role=admin inside the
// controller's router-level middleware.
app.use(`${env.API_PREFIX}/admin/reports`, reportsController.router);

// =====================================================================
// 404 + error handlers (last)
// =====================================================================

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
