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

/** 48px paper square with an ink icon, the same at the top and once pinned. */
function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Icon name={icon} color={brand.ink} size={22} />
    </Pressable>
  );
}

/**
 * The pinned header, option C (Nov 4): Back and ⋯ as paper tiles over the
 * big header, always on top, and a solid ink bar that fades in behind them
 * over the last 60pt before the big header scrolls off, then stays. The bar
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
        <Tile icon="back" label={t('common.back')} onPress={onBack} />
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
        {onMore ? <Tile icon="more" label={moreLabel} onPress={onMore} /> : <View style={styles.slot} />}
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
  tile: {
    width: size.tapMin,
    height: size.tapMin,
    backgroundColor: brand.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The ⋯ slot on the team's view: space only (Edit page goes here in PR 7).
  slot: { width: size.tapMin, height: size.tapMin },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  nameWrap: { flexShrink: 1 },
  stamp: { flexShrink: 0 },
  nameShadow: { position: 'absolute', top: 2, left: 2, right: -2 },
  pressed: { opacity: 0.75 },
});
