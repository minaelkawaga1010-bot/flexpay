import { useCallback, useState, useEffect } from 'react';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import logger from '@services/utils/logger';

const rnBiometrics = new ReactNativeBiometrics();

export interface BiometricsApi {
  available: boolean;
  type: keyof typeof BiometryTypes | null;
  authenticate: (reason?: string) => Promise<boolean>;
  enableBiometrics: () => Promise<boolean>;
}

export function useBiometrics(): BiometricsApi {
  const [available, setAvailable] = useState(false);
  const [type, setType] = useState<keyof typeof BiometryTypes | null>(null);

  useEffect(() => {
    rnBiometrics
      .isSensorAvailable()
      .then((result) => {
        setAvailable(result.available);
        if (result.biometryType) setType(result.biometryType as keyof typeof BiometryTypes);
      })
      .catch((err) => logger.warn('biometrics check failed', { error: (err as Error).message }));
  }, []);

  const authenticate = useCallback(async (reason = 'Authenticate to continue') => {
    try {
      const { success } = await rnBiometrics.simplePrompt({ promptMessage: reason });
      return success;
    } catch (err) {
      logger.warn('biometrics prompt failed', { error: (err as Error).message });
      return false;
    }
  }, []);

  const enableBiometrics = useCallback(async () => {
    if (!available) return false;
    return authenticate('Enable biometric login');
  }, [available, authenticate]);

  return { available, type, authenticate, enableBiometrics };
}
