import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { findBestLanguageTag } from 'react-native-localize';
import { I18nManager } from 'react-native';
import en from './locales/en.json';
import ar from './locales/ar.json';

const resources = {
  en: { translation: en },
  ar: { translation: ar },
} as const;

const supported = Object.keys(resources);
const detected = findBestLanguageTag(supported)?.languageTag ?? 'en';

void i18n.use(initReactI18next).init({
  resources,
  lng: detected,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // Sensible defaults for native — no Suspense, no namespaces.
  react: { useSuspense: false },
  compatibilityJSON: 'v4',
});

// Apply RTL on language change. Caller should reload the app for the
// layout swap to fully take effect.
i18n.on('languageChanged', (lng) => {
  const isRTL = lng === 'ar';
  if (I18nManager.isRTL !== isRTL) {
    I18nManager.allowRTL(isRTL);
    I18nManager.forceRTL(isRTL);
  }
});

export default i18n;
