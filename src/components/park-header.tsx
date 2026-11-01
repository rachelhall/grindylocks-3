import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotocopyBackdrop } from '@/components/photocopy';
import { Icon } from '@/components/ui';
import { brand, colors, fontFamily, size, space, stroke, Text } from '@/theme';

/** Height of the header below the status bar, per the Park page mockups. */
export const PARK_HEADER_HEIGHT = 300;

// The header is always ink, whatever the theme, so its colors are fixed.
const PAPER_BUTTON = colors.light.surfaceRaised;

/**
 * The park page header: the park's first photo, photocopied, under a pink
 * halftone (or the halftone alone on ink when there's no photo yet), with a
 * pink tape label and the park name bottom-left, and Back and More (plus Add
 * photos for contributors) on top. Tapping the photo opens the gallery.
 */
export function ParkHeader({
  name,
  tape,
  photoUrl,
  onOpenGallery,
  onMore,
  onAddPhotos,
}: {
  name: string;
  /** "NASHVILLE · SKATEPARK" */
  tape: string;
  photoUrl: string | null;
  /** Set when the park has photos. */
  onOpenGallery?: () => void;
  onMore: () => void;
  /** Set for members who can add park photos. */
  onAddPhotos?: () => void;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const height = PARK_HEADER_HEIGHT + insets.top;

  return (
    <View style={[styles.header, { height, paddingTop: insets.top }]}>
      <PhotocopyBackdrop width={width} height={height} photoUrl={photoUrl} />
      {onOpenGallery ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('parkPhotos.open', { park: name })}
          onPress={onOpenGallery}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View style={[styles.topRow, { top: insets.top + space[4] }]}>
        <SquareButton icon="back" label={t('common.back')} onPress={() => router.back()} />
        <View style={styles.topRight}>
          {onAddPhotos ? (
            <Pressable
              accessibilityRole="button"
              onPress={onAddPhotos}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            >
              <Icon name="addPhoto" color={brand.ink} size={20} />
              <Text variant="headline" style={styles.addLabel}>
                {t('parkPhotos.add')}
              </Text>
            </Pressable>
          ) : null}
          <SquareButton icon="more" label={t('park.more')} onPress={onMore} />
        </View>
      </View>

      <View style={[styles.titleBlock, { gap: photoUrl ? space[2] : space[3] }]} pointerEvents="none">
        <View style={styles.tape}>
          <Text variant="label" style={{ color: colors.light.onAccent }}>
            {tape}
          </Text>
        </View>
        <Text
          variant="displayXl"
          accessibilityRole="header"
          numberOfLines={3}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={styles.name}
        >
          {name}
        </Text>
      </View>
    </View>
  );
}

function SquareButton({ icon, label, onPress }: { icon: 'back' | 'more'; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.square, pressed && styles.pressed]}
    >
      <Icon name={icon} color={brand.ink} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: brand.ink,
    justifyContent: 'flex-end',
    paddingHorizontal: space[4],
    paddingBottom: 20,
    overflow: 'hidden',
  },
  topRow: {
    position: 'absolute',
    left: space[4],
    right: space[4],
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space[2],
  },
  topRight: { flexDirection: 'row', gap: space[2] },
  square: {
    width: size.tapMin,
    height: size.tapMin,
    backgroundColor: PAPER_BUTTON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    height: size.tapMin,
    paddingHorizontal: 14,
    borderWidth: stroke.rule,
    borderColor: brand.ink,
    backgroundColor: colors.light.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  addLabel: { color: colors.light.onAccent, fontSize: 15, lineHeight: 20 },
  pressed: { opacity: 0.75 },
  titleBlock: { alignItems: 'flex-start' },
  tape: {
    backgroundColor: colors.light.accent,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    transform: [{ rotate: '-2deg' }],
  },
  name: {
    fontFamily: fontFamily.display,
    color: brand.paper,
    letterSpacing: -0.48,
    textShadowColor: brand.pink,
    textShadowOffset: { width: 3, height: 3 },
    // Android draws no shadow at radius 0; a hair above keeps it crisp.
    textShadowRadius: Platform.OS === 'android' ? 0.01 : 0,
  },
});
