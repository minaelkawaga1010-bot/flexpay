import { env } from '@config/env';
import logger from '@shared/utils/logger';

let client: ReturnType<typeof import('twilio').default> | null = null;

function getClient() {
  if (client) return client;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require('twilio');
  client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return client;
}

export const twilioService = {
  async sendSms(to: string, body: string): Promise<void> {
    const c = getClient();
    if (!c) {
      logger.info('[twilio:stub] sms', { to, body });
      return;
    }
    await c.messages.create({ to, from: env.TWILIO_PHONE_NUMBER, body });
  },
};
