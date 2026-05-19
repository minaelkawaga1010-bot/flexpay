import { env } from './env';
import logger from '@shared/utils/logger';

let messaging: import('firebase-admin').messaging.Messaging | null = null;

export function getFirebaseMessaging(): import('firebase-admin').messaging.Messaging | null {
  if (messaging) return messaging;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_CLIENT_EMAIL) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.FIREBASE_PROJECT_ID,
          privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    }
    messaging = admin.messaging();
    return messaging;
  } catch (err) {
    logger.warn('Firebase init failed; push notifications disabled', {
      error: (err as Error).message,
    });
    return null;
  }
}
