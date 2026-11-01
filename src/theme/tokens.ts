/**
 * Grindylocks design tokens, from the Grindylocks design system (tokens.json).
 * The design system is the source of truth; change values there first, then
 * mirror them here.
 *
 * Two layers: the brand layer (logo, splash, onboarding) may use the raw
 * brand inks; the product layer (feeds, park pages, profiles) uses only the
 * semantic colors below. Pink in the UI is always `accent`, as a fill with
 * `onAccent` on it; when pink must be text, use `accentText`.
 */

export const brand = {
  pink: '#FF48B0',
  blue: '#0078BF', // brand layer only, overprinted with pink; never UI text or lines
  ink: '#111111',
  paper: '#F2EFE6',
} as const;

const shared = {
  accent: brand.pink,
  onAccent: '#111111',
  accentSubtle: '#FBE3EA', // picked multi-select choices; same in both themes
  onAccentSubtle: '#111111',
  onAccentSubtleSecondary: '#4A4740',
  role: '#005F99', // role badges only
  onRole: '#F2EFE6',
  mapPin: brand.pink,
  mapPinOutline: '#111111',
} as const;

export const colors = {
  light: {
    ...shared,
    surface: '#F2EFE6',
    surfaceRaised: '#FAF8F2',
    surfaceSunk: '#E6E2D6',
    text: '#111111',
    textSecondary: '#4A4740',
    textMuted: '#6E6A60', // not on surfaceSunk
    border: '#111111',
    borderSubtle: '#CFCABB',
    accentText: '#C2006F',
    focus: '#111111',
    statusOpen: '#1E7A3E',
    statusSeasonal: '#8A5A00',
    statusClosed: '#B3261E',
    statusSoon: '#4A4740',
  },
  dark: {
    ...shared,
    surface: '#111111',
    surfaceRaised: '#1C1C1C',
    surfaceSunk: '#0A0A0A',
    text: '#F2EFE6',
    textSecondary: '#B8B4AA',
    textMuted: '#8C887E',
    border: '#F2EFE6',
    borderSubtle: '#333333',
    accentText: '#FF48B0',
    focus: '#F2EFE6',
    statusOpen: '#4CC27A',
    statusSeasonal: '#F2B233',
    statusClosed: '#FF8A5C',
    statusSoon: '#B8B4AA',
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ThemeColors = (typeof colors)[ColorScheme];

/** Font family names, as registered in app/_layout.tsx with expo-font. */
export const fontFamily = {
  display: 'ArchivoBlack_400Regular',
  sans: 'Archivo_400Regular',
  sansSemiBold: 'Archivo_600SemiBold',
} as const;

/**
 * Type styles. Display styles (displayXl, display, title) are always
 * uppercase; render them through <Text variant="..."> so that's automatic.
 */
export const type = {
  displayXl: { fontFamily: fontFamily.display, fontSize: 48, lineHeight: 46 },
  display: { fontFamily: fontFamily.display, fontSize: 32, lineHeight: 32 },
  title: { fontFamily: fontFamily.display, fontSize: 22, lineHeight: 24 },
  headline: { fontFamily: fontFamily.sansSemiBold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fontFamily.sans, fontSize: 16, lineHeight: 24 },
  bodySm: { fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20 },
  label: {
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 12 * 0.06,
  },
  caption: { fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 16 },
} as const;

export type TypeVariant = keyof typeof type;
export const uppercaseVariants: readonly TypeVariant[] = ['displayXl', 'display', 'title', 'label'];

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 } as const;

/** No rounded corners anywhere: buttons, chips, cards, avatars, media. */
export const radius = { none: 0 } as const;

export const stroke = { hairline: 1, rule: 2 } as const;

export const size = {
  tapMin: 48, // minimum tappable size, for outdoor use and gloves
  icon: 24,
} as const;
