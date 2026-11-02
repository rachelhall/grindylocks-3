// Copies the push notification sentences from the app's translation files
// into the push-send Edge Function, so a push reads exactly like its row
// under the bell. Run after changing any `notifications.*` string:
//   node scripts/build-push-strings.mjs
// `npm run check:i18n` fails if the copy is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['en', 'es', 'da', 'de'];
const keys = ['commentOne', 'reply', 'mention', 'tag', 'filmer', 'inviteUsed', 'someoneNew', 'visiting', 'visitingPark'];

export function pushStrings() {
  const out = {};
  for (const lang of languages) {
    const file = JSON.parse(readFileSync(join(root, 'src/i18n/locales', `${lang}.json`), 'utf8'));
    out[lang] = Object.fromEntries(keys.map((k) => [k, file.notifications[k]]));
  }
  return JSON.stringify(out, null, 2) + '\n';
}

export const pushStringsPath = join(root, 'supabase/functions/push-send/strings.json');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(pushStringsPath, pushStrings());
  console.log(`Wrote ${pushStringsPath}`);
}
