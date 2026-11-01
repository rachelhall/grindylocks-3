// Fails if es, da or de is missing a key from en, or has one en doesn't.
// Run with: npm run check:i18n
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url));
const load = (lang) => JSON.parse(readFileSync(`${dir}${lang}.json`, 'utf8'));

const keys = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const source = new Set(keys(load('en')));
let failed = false;

for (const lang of ['es', 'da', 'de']) {
  const target = new Set(keys(load(lang)));
  const missing = [...source].filter((k) => !target.has(k));
  const extra = [...target].filter((k) => !source.has(k));
  if (missing.length || extra.length) {
    failed = true;
    if (missing.length) console.error(`${lang}: missing ${missing.join(', ')}`);
    if (extra.length) console.error(`${lang}: not in en ${extra.join(', ')}`);
  }
}

if (failed) process.exit(1);
console.log(`Translations OK: ${source.size} keys in en, es, da and de.`);
