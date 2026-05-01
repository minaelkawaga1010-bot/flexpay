import { env } from '../config/env';
import { logger } from '../config/logger';

let client: ReturnType<typeof import('twilio').default> | null = null;

function getClient() {
  if (client) return client;
  if (!env.twilio.accountSid || !env.twilio.authToken) {
    return null;
  }
  // Lazy-require so missing creds don't block boot in dev/test.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require('twilio');
  client = twilio(env.twilio.accountSid, env.twilio.authToken);
  return client;
}

export const twilioService = {
  async sendSms(to: string, body: string): Promise<void> {
    const c = getClient();
    if (!c) {
      logger.info({ to, body }, '[twilio:stub] sms');
      return;
    }
    await c.messages.create({ to, from: env.twilio.fromNumber, body });
  },
};
