import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import da from './locales/da.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';

/**
 * App languages: English, Spanish, Danish and German. English is the source
 * and the fallback. Trick names are never translated, so they don't belong in
 * these files. Captions, comments and other user content stay as written.
 */
export const resources = {
  en: { translation: en },
  es: { translation: es },
  da: { translation: da },
  de: { translation: de },
} as const;

export type AppLanguage = keyof typeof resources;
export const appLanguages = Object.keys(resources) as AppLanguage[];

function deviceLanguage(): AppLanguage {
  for (const locale of getLocales()) {
    const code = locale.languageCode as AppLanguage | null;
    if (code && code in resources) return code;
  }
  return 'en';
}

/**
 * Metric or imperial for obstacle sizes and park areas. Stored values are
 * always metric; this only decides how they're shown.
 */
export function usesMetric(): boolean {
  return getLocales()[0]?.measurementSystem !== 'us';
}

/** "Denmark" for "DK", in the reader's language; falls back to the code. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const i18n = createInstance();

i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes output
  returnNull: false,
});

export default i18n;
