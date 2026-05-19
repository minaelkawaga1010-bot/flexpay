import { env } from '@config/env';
import logger from '@shared/utils/logger';

// The twilio types export `Twilio` as the runtime client class. We can't
// `import type {Twilio} from 'twilio'` and lazy-require at the same time
// without dual-loading the module, so we type the cache loosely and rely
// on the SDK's runtime API surface.
let cachedClient: { messages: { create: (opts: Record<string, unknown>) => Promise<unknown> } } | null = null;

function getClient() {
  if (cachedClient) return cachedClient;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require('twilio');
  cachedClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return cachedClient;
}

export const twilioService = {
  async sendSms(to: string, body: string): Promise<void> {
    const client = getClient();
    if (!client) {
      logger.info('[twilio:stub] sms', { to, body });
      return;
    }
    await client.messages.create({ to, from: env.TWILIO_PHONE_NUMBER, body });
  },

  async sendOTP(phone: string, otp: string): Promise<void> {
    return this.sendSms(
      phone,
      `Your FlexPay verification code is ${otp}. It expires in 5 minutes. Never share this code.`,
    );
  },

  async sendWelcomeSMS(phone: string): Promise<void> {
    return this.sendSms(
      phone,
      'Welcome to FlexPay! Your wallet is ready. Download the app: https://flexpay.ae/download',
    );
  },
};
