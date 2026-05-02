import EncryptedStorage from 'react-native-encrypted-storage';
import logger from '@services/utils/logger';

/**
 * Generic encrypted KV for non-credential data (e.g. cached preferences,
 * onboarding flags). Tokens go through `tokenManager` instead.
 */
export const secureStorage = {
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const raw = await EncryptedStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      logger.warn('secureStorage:get failed', { key, error: (err as Error).message });
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await EncryptedStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      logger.warn('secureStorage:set failed', { key, error: (err as Error).message });
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await EncryptedStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
