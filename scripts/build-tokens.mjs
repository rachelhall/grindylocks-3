// Builds both apps' design tokens from design/tokens.json, a copy of the
// Grindylocks design system's tokens.json. The design system is the source of
// truth: change a value there, copy its tokens.json to design/tokens.json,
// then run:
//   npm run tokens
// It writes:
//   src/theme/tokens.ts         the mobile app's theme constants
//   web/src/styles/tokens.css   CSS variables for the web admin (--gl-*), plus
//                               the shadcn/ui variables mapped onto them
// `npm run check:tokens` fails if either file is out of date.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8'));

export const outputs = {
  mobile: join(root, 'src/theme/tokens.ts'),
  web: join(root, 'web/src/styles/tokens.css'),
};

const themes = source.color.themes.map((t) => t.id); // ['light', 'dark'], light first
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const px = (v) => Number(String(v).replace(/px$/, ''));
const isWebOnly = (t) => /^Web only/.test(t.usage ?? '');

// Resolve every color to one value per theme, following {alias} references.
const byName = new Map(source.color.tokens.map((t) => [t.name, t]));
function resolve(name, theme, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Alias loop at ${name}`);
  seen.add(name);
  const token = byName.get(name);
  if (!token) throw new Error(`Unknown color token ${name}`);
  let v = token.value;
  if (typeof v === 'object') v = v[theme] ?? v[themes[0]];
  const alias = /^\{(.+)\}$/.exec(v);
  return alias ? resolve(alias[1], theme, seen) : v;
}
const colors = source.color.tokens.map((t) => ({
  name: t.name,
  values: Object.fromEntries(themes.map((th) => [th, resolve(t.name, th)])),
}));

// ---------------------------------------------------------------- mobile

// Font family names as registered with expo-font in app/_layout.tsx.
const expoFonts = { display: { 400: 'ArchivoBlack_400Regular' }, sans: { 400: 'Archivo_400Regular', 600: 'Archivo_600SemiBold' } };
const fontKey = { ArchivoBlack_400Regular: 'display', Archivo_400Regular: 'sans', Archivo_600SemiBold: 'sansSemiBold' };
// Display styles and label chips are always uppercase.
const uppercase = (group, style) => group.name === 'Display' || style.name === 'label';

function mobile() {
  const lit = (v) => `'${v}'`;
  const brand = colors.filter((c) => c.name.startsWith('brand-'));
  const rest = colors.filter((c) => !c.name.startsWith('brand-'));
  const same = (c) => themes.every((th) => c.values[th] === c.values[themes[0]]);
  const shared = rest.filter(same);
  const themed = rest.filter((c) => !same(c));

  const styles = source.type.groups.flatMap((g) =>
    g.styles.map((s) => {
      const fam = expoFonts[g.family][s.fontWeight];
      if (!fam) throw new Error(`No expo-font face for ${g.family} ${s.fontWeight}`);
      const size = px(s.fontSize);
      const parts = [`fontFamily: fontFamily.${fontKey[fam]}`, `fontSize: ${size}`, `lineHeight: ${px(s.lineHeight)}`];
      if (s.letterSpacing) {
        const em = Number(String(s.letterSpacing).replace(/em$/, ''));
        parts.push(`letterSpacing: ${Math.round(size * em * 100) / 100}`);
      }
      return { key: camel(s.name), line: `  ${camel(s.name)}: { ${parts.join(', ')} },`, upper: uppercase(g, s) };
    }),
  );
  const sizes = source.size.tokens.filter((t) => !isWebOnly(t));

  return `/**
 * Grindylocks design tokens. GENERATED from design/tokens.json by
 * scripts/build-tokens.mjs: don't edit this file. Change the value in the
 * design system, copy its tokens.json to design/tokens.json and run
 * \`npm run tokens\`.
 *
 * Two layers: the brand layer (logo, splash, onboarding) may use the raw
 * brand inks; the product layer (feeds, park pages, profiles) uses only the
 * semantic colors below. Pink in the UI is always \`accent\`, as a fill with
 * \`onAccent\` on it; when pink must be text, use \`accentText\`.
 */

export const brand = {
${brand.map((c) => `  ${camel(c.name.replace(/^brand-/, ''))}: ${lit(c.values[themes[0]])},`).join('\n')}
} as const;

const shared = {
${shared.map((c) => `  ${camel(c.name)}: ${lit(c.values[themes[0]])},`).join('\n')}
} as const;

export const colors = {
${themes
  .map(
    (th) => `  ${th}: {
    ...shared,
${themed.map((c) => `    ${camel(c.name)}: ${lit(c.values[th])},`).join('\n')}
  },`,
  )
  .join('\n')}
} as const;

export type ColorScheme = keyof typeof colors;
export type ThemeColors = (typeof colors)[ColorScheme];

/** Font family names, as registered in app/_layout.tsx with expo-font. */
export const fontFamily = {
${Object.entries(fontKey).map(([fam, key]) => `  ${key}: '${fam}',`).join('\n')}
} as const;

/**
 * Type styles. Display styles and labels are always uppercase; render them
 * through <Text variant="..."> so that's automatic.
 */
export const type = {
${styles.map((s) => s.line).join('\n')}
} as const;

export type TypeVariant = keyof typeof type;
export const uppercaseVariants: readonly TypeVariant[] = [${styles.filter((s) => s.upper).map((s) => `'${s.key}'`).join(', ')}];

export const space = { ${source.spacing.tokens.map((t) => `${t.name.replace(/^space-/, '')}: ${px(t.value)}`).join(', ')} } as const;

/** No rounded corners anywhere: buttons, chips, cards, avatars, media. */
export const radius = { ${source.radius.tokens.map((t) => `${camel(t.name.replace(/^radius-/, ''))}: ${px(t.value)}`).join(', ')} } as const;

export const stroke = { ${source.stroke.tokens.map((t) => `${camel(t.name.replace(/^stroke-/, ''))}: ${px(t.value)}`).join(', ')} } as const;

export const size = { ${sizes.map((t) => `${camel(t.name)}: ${px(t.value)}`).join(', ')} } as const;
`;
}

// ------------------------------------------------------------------- web

// shadcn/ui variable -> Grindylocks token. Note the name clash: shadcn's
// "accent" is a hover background, not the brand accent; Grindylocks pink is
// shadcn's "primary".
const shadcn = {
  background: 'surface',
  foreground: 'text',
  card: 'surface-raised',
  'card-foreground': 'text',
  popover: 'surface-raised',
  'popover-foreground': 'text',
  primary: 'accent',
  'primary-foreground': 'on-accent',
  secondary: 'surface',
  'secondary-foreground': 'text',
  muted: 'surface-sunk',
  'muted-foreground': 'text-secondary', // text-muted fails on surface-sunk
  accent: 'surface-raised',
  'accent-foreground': 'text',
  destructive: 'danger',
  'destructive-foreground': 'on-danger',
  border: 'border',
  input: 'border',
  ring: 'focus',
  sidebar: 'surface',
  'sidebar-foreground': 'text',
  'sidebar-primary': 'accent',
  'sidebar-primary-foreground': 'on-accent',
  'sidebar-accent': 'surface-raised',
  'sidebar-accent-foreground': 'text',
  'sidebar-border': 'border',
  'sidebar-ring': 'focus',
};

function web() {
  const [first, ...others] = themes;
  const colorVars = (th) => colors.map((c) => `  --gl-${c.name}: ${c.values[th]};`).join('\n');
  const varsFor = (fam) => source[fam].tokens.map((t) => `  --gl-${t.name}: ${/^\d+$/.test(String(t.value)) ? `${t.value}px` : t.value};`);
  const typeVars = source.type.groups.flatMap((g) =>
    g.styles.map((s) =>
      [
        `  --gl-type-${s.name}: ${s.fontSize};`,
        `  --gl-type-${s.name}--line-height: ${s.lineHeight};`,
        `  --gl-type-${s.name}--font-weight: ${s.fontWeight};`,
        `  --gl-type-${s.name}--font-family: var(--gl-font-${g.family});`,
        s.letterSpacing ? `  --gl-type-${s.name}--letter-spacing: ${s.letterSpacing};` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  );
  for (const [k, v] of Object.entries(shadcn)) if (!byName.has(v)) throw new Error(`shadcn ${k} maps to unknown token ${v}`);

  return `/* Grindylocks design tokens. GENERATED from design/tokens.json by
   scripts/build-tokens.mjs: don't edit this file. Change the value in the
   design system, copy its tokens.json to design/tokens.json and run
   \`npm run tokens\` from the repo root. */

:root {
  color-scheme: ${themes.join(' ')};

  /* Colors (${first}) */
${colorVars(first)}

  /* Type */
${Object.entries(source.type.families).map(([k, v]) => `  --gl-font-${k}: ${v};`).join('\n')}
${typeVars.join('\n')}

  /* Spacing, radius, stroke, size and layout */
${['spacing', 'radius', 'stroke', 'size', 'layout'].flatMap(varsFor).join('\n')}

  /* shadcn/ui, mapped onto the tokens above */
  --radius: var(--gl-radius-none);
${Object.entries(shadcn).map(([k, v]) => `  --${k}: var(--gl-${v});`).join('\n')}
}
${others
  .map(
    (th) => `
/* Colors (${th}), following the device setting */
@media (prefers-color-scheme: ${th}) {
  :root {
${colors
  .filter((c) => c.values[th] !== c.values[first])
  .map((c) => `    --gl-${c.name}: ${c.values[th]};`)
  .join('\n')}
  }
}
`,
  )
  .join('')}`;
}

export const built = { mobile: mobile(), web: web() };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = false;
  for (const [key, path] of Object.entries(outputs)) {
    if (check) {
      let current = '';
      try {
        current = readFileSync(path, 'utf8');
      } catch {
        // missing counts as stale
      }
      if (current !== built[key]) {
        stale = true;
        console.error(`${path} is out of date: run npm run tokens`);
      }
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, built[key]);
      console.log(`Wrote ${path}`);
    }
  }
  if (stale) process.exit(1);
}
