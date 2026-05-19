import { Platform } from 'react-native';

const DEV_HOST = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

export const apiConfig = {
  baseURL: __DEV__ ? `${DEV_HOST}/api/v1` : 'https://api.flexpay.ae/api/v1',
  timeout: 20_000,
  appVersion: '1.0.0',
  deviceOS: Platform.OS,
} as const;
