// The web keeps its own copies of a little shared app code (Nov 6), so the
// web stream never edits `src/`. This fails when a copy has gone stale:
//   - src/lib/hours.ts must match the app's src/lib/hours.ts byte for byte;
//   - src/lib/obstacle-types.ts must hold the app's English obstacleTypes.
// Fix: copy hours.ts over again, or update the names in obstacle-types.ts.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(web, "..");
const problems = [];

const read = (path) => readFileSync(path, "utf8");

if (read(join(web, "src/lib/hours.ts")) !== read(join(app, "src/lib/hours.ts"))) {
  problems.push("web/src/lib/hours.ts differs from src/lib/hours.ts (copy it over again).");
}

const names = JSON.parse(read(join(app, "src/i18n/locales/en.json"))).obstacleTypes;
const copy = read(join(web, "src/lib/obstacle-types.ts"));
const found = Object.fromEntries([...copy.matchAll(/^\s+([a-z_]+): ("(?:[^"\\]|\\.)*"),$/gm)].map((m) => [m[1], JSON.parse(m[2])]));
if (JSON.stringify(found) !== JSON.stringify(names)) {
  problems.push("web/src/lib/obstacle-types.ts doesn't match obstacleTypes in src/i18n/locales/en.json.");
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Shared copies match the app.");
