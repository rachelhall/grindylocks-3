import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { useWelcomeMetroAreas } from '@/lib/parks';
import { brand, colors, fontFamily, space, Text } from '@/theme';

/**
 * The GRINDYLOCKS wordmark on one line, for the brand screens (welcome and
 * invite): paper with a hard pink offset, like the park name in the park
 * header. It shrinks to fit narrow phones and large text sizes rather than
 * wrapping.
 */
export function Wordmark() {
  const { t } = useTranslation();
  const name = t('common.appName');
  return (
    <View>
      {/* A second copy, offset 3px, is the pink shadow: Android won't draw a hard text shadow. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={[styles.wordmark, styles.shadow, { color: brand.pink }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {name}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        accessibilityRole="header"
        style={[styles.wordmark, { color: brand.paper }]}
      >
        {name}
      </Text>
    </View>
  );
}

/** How many metro areas show as tape before "+N more". */
const SHOWN = 6;
/** Hand-stuck tilts, repeated if there are more pieces than tilts. */
const TILTS = [-3, 2, 1, -2, 2, -1.5];

/**
 * "Parks in" and a tape piece per metro area that has parks, most parks
 * first, then "+N more". Comes from the park directory, so new cities show
 * up on their own. Shows nothing while loading or if it can't load: the
 * screen works without it.
 */
export function CityTape() {
  const { t } = useTranslation();
  const metros = useWelcomeMetroAreas();
  const names = metros.data ?? [];
  if (names.length === 0) return null;

  const shown = names.slice(0, SHOWN);
  const more = names.length - shown.length;

  return (
    <View
      style={styles.tapeBlock}
      accessible
      accessibilityLabel={`${t('auth.welcome.parksIn')} ${shown.join(', ')}${more > 0 ? `, ${t('auth.welcome.moreCities', { count: more })}` : ''}`}
    >
      <Text variant="label" style={{ color: colors.dark.textSecondary }}>
        {t('auth.welcome.parksIn')}
      </Text>
      <View style={styles.tapeRow}>
        {shown.map((name, i) => (
          <View
            key={name}
            style={[
              styles.tape,
              {
                backgroundColor: i % 3 === 1 ? brand.paper : brand.pink,
                transform: [{ rotate: `${TILTS[i % TILTS.length]}deg` }],
              },
            ]}
          >
            <Text numberOfLines={1} style={styles.tapeText}>
              {name}
            </Text>
          </View>
        ))}
        {more > 0 ? (
          <View style={[styles.more, { transform: [{ rotate: '-1deg' }] }]}>
            <Text numberOfLines={1} style={[styles.tapeText, { color: brand.paper }]}>
              {t('auth.welcome.moreCities', { count: more })}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    fontFamily: fontFamily.display,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.8,
    textTransform: 'uppercase',
    // Leaves room for the offset copy so it isn't clipped at the right edge.
    marginRight: 3,
  },
  shadow: { position: 'absolute', top: 3, left: 3, right: 0 },
  tapeBlock: { gap: space[3] },
  tapeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: space[3] },
  tape: { paddingHorizontal: space[3], paddingVertical: 6 },
  more: {
    paddingHorizontal: 10,
    paddingVertical: space[1],
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: brand.paper,
  },
  tapeText: {
    fontFamily: fontFamily.display,
    fontSize: 22,
    lineHeight: 26,
    textTransform: 'uppercase',
    color: brand.ink,
    // Android pads display type unevenly inside tight boxes.
    includeFontPadding: Platform.OS === 'android' ? false : undefined,
  },
});
