import 'i18next';

import type en from './locales/en.json';

// Typed keys: t('home.title') autocompletes, and a key missing from the
// English file is a type error. English is the source of truth; the other
// three files are checked against it by scripts/check-translations.mjs.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
