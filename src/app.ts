import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import nymcardWebhooks from './modules/webhooks/nymcardWebhooks';
import routes from './routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  if (env.nodeEnv !== 'test') app.use(morgan('combined'));

  // Webhooks need raw bodies for HMAC signature verification — mount them
  // BEFORE express.json() so the body remains a Buffer.
  app.use('/webhooks/nymcard', express.raw({ type: 'application/json' }), nymcardWebhooks);

  // Standard JSON parser for the rest of the API.
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'flexpay-api', timestamp: new Date().toISOString() });
  });

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
