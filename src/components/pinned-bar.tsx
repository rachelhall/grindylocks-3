import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StampTape } from '@/components/pages';
import { Icon, type IconName } from '@/components/ui';
import type { Stamp } from '@/lib/pages';
import { brand, size, space, Text } from '@/theme';

/** How far the scroll travels while the bar fades in, ending as the header leaves. */
const FADE = 60;
/** The bar's title is capped at this text size so the bar keeps its height (Large Text). */
const TITLE_MAX_SCALE = 1.3;

/** The pinned bar's full height: the top inset plus the `bar-row` row. */
export function useBarHeight() {
  return useSafeAreaInsets().top + size.barRow;
}

/**
 * Back or ⋯. At the top it's a 48px paper tile with an ink icon, so it reads
 * over a photo or halftone. As the ink bar fades in (`progress` 0 → 1), the
 * tile's paper fades out and the icon cross-fades from ink to paper, so it's
 * never ink on ink. On the solid bar it's a bare paper icon. The pressable
 * stays 48px the whole way, so the touch target and focus ring don't change.
 */
function BarButton({
  icon,
  label,
  progress,
  onPress,
}: {
  icon: IconName;
  label: string;
  progress: Animated.AnimatedInterpolation<number>;
  onPress: () => void;
}) {
  const tile = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.tile, { opacity: tile }]} />
      <Animated.View style={[styles.glyph, { opacity: tile }]}>
        <Icon name={icon} color={brand.ink} />
      </Animated.View>
      <Animated.View style={[styles.glyph, { opacity: progress }]}>
        <Icon name={icon} color={brand.paper} />
      </Animated.View>
    </Pressable>
  );
}

/**
 * The pinned header, option C (Nov 4): Back and ⋯ always on top, as paper
 * tiles over the big header, and a solid ink bar that fades in behind them
 * over the last 60pt before the big header scrolls off, then stays. As the
 * bar fades in, the tiles fade out: on the solid bar Back and ⋯ are bare
 * paper icons (paper, not pink: pink means selected). The bar
 * carries the name (Archivo Black, paper, pink 2pt offset, one line) and the
 * page's stamp. It's printed ink in both themes, like the header, so the
 * status bar stays light the whole way.
 *
 * Render it before the ScrollView so VoiceOver reaches Back and ⋯ first; it
 * draws on top through its zIndex. The bar's copy of the name is hidden from
 * VoiceOver: the big header's name stays the screen's heading.
 */
export function PinnedBar({
  scrollY,
  headerHeight,
  name,
  stamp,
  moreLabel,
  onBack,
  onMore,
}: {
  /** The ScrollView's contentOffset.y, driven natively. */
  scrollY: Animated.Value;
  /** Height of the big header, status bar included. */
  headerHeight: number;
  name: string;
  /** Pages only; parks have none. */
  stamp?: Stamp;
  moreLabel: string;
  onBack: () => void;
  /** Left out for the page's own team: the slot stays empty so nothing shifts. */
  onMore?: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const barHeight = insets.top + size.barRow;
  // The header's bottom edge reaches the bar's bottom edge here.
  const pinAt = Math.max(headerHeight - barHeight, 1);
  const opacity = scrollY.interpolate({
    inputRange: [Math.max(pinAt - FADE, 0), pinAt],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Once the bar shows, it takes taps (so they don't land on what's scrolled
  // under it); before that, taps pass through to the header.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const id = scrollY.addListener(({ value }) => setPinned(value >= pinAt - FADE / 2));
    return () => scrollY.removeListener(id);
  }, [scrollY, pinAt]);

  return (
    <View pointerEvents="box-none" style={[styles.bar, { height: barHeight }]}>
      <Animated.View
        pointerEvents={pinned ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, { backgroundColor: brand.ink, opacity }]}
      />
      <View pointerEvents="box-none" style={[styles.row, { paddingTop: insets.top + space[2] }]}>
        <BarButton icon="back" label={t('common.back')} progress={opacity} onPress={onBack} />
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.title, { opacity }]}
        >
          <View style={styles.nameWrap}>
            {/* A second copy, offset 2px, is the pink shadow, as in the big header. */}
            <Text
              variant="title"
              numberOfLines={1}
              maxFontSizeMultiplier={TITLE_MAX_SCALE}
              style={[styles.nameShadow, { color: brand.pink }]}
            >
              {name}
            </Text>
            <Text variant="title" numberOfLines={1} maxFontSizeMultiplier={TITLE_MAX_SCALE} style={{ color: brand.paper }}>
              {name}
            </Text>
          </View>
          {stamp ? (
            // The name truncates first; the stamp never shrinks.
            <View style={styles.stamp}>
              <StampTape stamp={stamp} onInk small maxFontSizeMultiplier={TITLE_MAX_SCALE} />
            </View>
          ) : null}
        </Animated.View>
        {onMore ? (
          <BarButton icon="more" label={moreLabel} progress={opacity} onPress={onMore} />
        ) : (
          <View style={styles.slot} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, elevation: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
  },
  button: {
    width: size.tapMin,
    height: size.tapMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: { backgroundColor: brand.paper },
  // Both icons sit in the same spot; only one shows at a time, except mid-fade.
  glyph: { position: 'absolute' },
  // The ⋯ slot on the team's view: space only (Edit page goes here in PR 7).
  slot: { width: size.tapMin, height: size.tapMin },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  nameWrap: { flexShrink: 1 },
  stamp: { flexShrink: 0 },
  nameShadow: { position: 'absolute', top: 2, left: 2, right: -2 },
  pressed: { opacity: 0.75 },
});
