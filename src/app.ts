import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { env, isProd, isTest } from '@config/env';
import { errorHandler, notFoundHandler } from '@shared/middleware/error-handler';
import nymcardWebhook from '@webhooks/nymcard.webhook';
import moneyhashWebhook from '@webhooks/moneyhash.webhook';
import flexxpayWebhook from '@webhooks/flexxpay.webhook';
import routes from './routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(compression());
  if (!isTest) app.use(morgan(isProd ? 'combined' : 'dev'));

  // Webhook routers receive raw bodies for HMAC signature verification.
  app.use('/webhooks/nymcard', express.raw({ type: 'application/json', limit: '1mb' }), nymcardWebhook);
  app.use('/webhooks/moneyhash', express.raw({ type: 'application/json', limit: '1mb' }), moneyhashWebhook);
  app.use('/webhooks/flexxpay', express.raw({ type: 'application/json', limit: '1mb' }), flexxpayWebhook);

  // Standard JSON parser for the rest of the API.
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: env.APP_NAME,
      env: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(env.API_PREFIX, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
