import logger from '@services/utils/logger';
import { EventName } from './events';

/**
 * Thin facade over Amplitude. We log to the console in dev so the same
 * call sites work without Amplitude credentials configured.
 */
export function logEvent(name: EventName | string, props?: Record<string, unknown>): void {
  if (__DEV__) {
    logger.debug('analytics:event', { name, ...props });
    return;
  }
  // In prod, plug in the Amplitude / Mixpanel SDK here.
}

export function logError(name: string, err: unknown, props?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('analytics:error', { name, message, ...props });
}

export function identify(userId: string, traits?: Record<string, unknown>): void {
  logger.debug('analytics:identify', { userId, ...traits });
}
