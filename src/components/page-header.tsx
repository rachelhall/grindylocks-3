import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HalftoneGround } from '@/components/park-header';
import { StampTape } from '@/components/pages';
import { Icon, type IconName } from '@/components/ui';
import type { Stamp } from '@/lib/pages';
import { brand, size, space, stroke, Text } from '@/theme';

/** Height of a page header, status bar included. Name-only pages get a shorter, plain one. */
export const PAGE_HEADER_HEIGHT = 300;
export const PLAIN_HEADER_HEIGHT = 228;
/** The logo tile overlaps the header's bottom edge by this much. */
export const LOGO_OVERLAP = 38;
const LOGO_SIZE = 76;

function HeaderButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
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

/**
 * A brand or shop page's header, per the Brand accounts (v2) mockups. It
 * reuses the park header's look: the name in Archivo Black with the pink
 * offset over ink and the pink halftone, under a tilted tape (BRAND · SANTA
 * ANA). Then, by state:
 *
 * - Official (managed, with a logo): the pink OFFICIAL stamp after the name
 *   and the logo tile overlapping the bottom-left.
 * - Unofficial: the paper UNOFFICIAL stamp, no logo.
 * - Name only (`plain`): no halftone, no tape, no pink offset.
 * - Retired and Closed (`dim`): the halftone dimmed, and the RETIRED or
 *   CLOSED stamp.
 *
 * Founding partner is a paper tape beside the type tape. Like the park
 * header, it's dark in both themes, so it uses brand ink and paper.
 */
export function PageHeader({
  name,
  tape,
  stamp,
  foundingPartner = false,
  logoUrl,
  plain = false,
  dim = false,
  moreLabel,
  onBack,
  onMore,
}: {
  name: string;
  /** "BRAND · SANTA ANA"; null for a name-only page. */
  tape: string | null;
  stamp: Stamp;
  foundingPartner?: boolean;
  /** Official pages only. */
  logoUrl: string | null;
  plain?: boolean;
  dim?: boolean;
  moreLabel: string;
  onBack: () => void;
  /** Hidden when there's nothing in the menu (the page's own team, for now). */
  onMore?: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const height = plain ? PLAIN_HEADER_HEIGHT : PAGE_HEADER_HEIGHT;

  return (
    <View style={[styles.header, { height, paddingBottom: logoUrl ? LOGO_OVERLAP + 12 : 22 }]}>
      <View style={[StyleSheet.absoluteFill, styles.ground]}>
        {plain ? null : (
          <View style={[StyleSheet.absoluteFill, dim && styles.dim]}>
            <HalftoneGround />
          </View>
        )}
      </View>

      <View style={styles.titleBlock}>
        {tape || foundingPartner ? (
          <View style={styles.tapes}>
            {tape ? (
              <View style={[styles.tape, { backgroundColor: brand.pink }]}>
                <Text variant="label" style={{ color: brand.ink }}>
                  {tape}
                </Text>
              </View>
            ) : null}
            {foundingPartner ? (
              <View style={[styles.tape, styles.partner, { backgroundColor: brand.paper }]}>
                <Text variant="label" style={{ color: brand.ink }}>
                  {t('page.foundingPartner')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.nameRow}>
          <View style={styles.nameWrap}>
            {plain ? null : (
              <Text
                variant="displayXl"
                numberOfLines={3}
                style={[styles.name, styles.nameShadow, { color: brand.pink }]}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {name}
              </Text>
            )}
            <Text
              variant="displayXl"
              numberOfLines={3}
              accessibilityRole="header"
              style={[styles.name, plain && styles.plainName, { color: brand.paper }]}
            >
              {name}
            </Text>
          </View>
          <StampTape stamp={stamp} onInk />
        </View>
      </View>

      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          style={styles.logo}
          contentFit="contain"
          accessibilityLabel={t('page.logo', { name })}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View style={[styles.topRow, { top: Math.max(space[4], insets.top + space[1]) }]}>
        <HeaderButton icon="back" label={t('common.back')} onPress={onBack} />
        {onMore ? <HeaderButton icon="more" label={moreLabel} onPress={onMore} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { justifyContent: 'flex-end', paddingHorizontal: space[4], zIndex: 1 },
  ground: { backgroundColor: brand.ink, overflow: 'hidden' },
  dim: { opacity: 0.45 },
  titleBlock: { alignItems: 'flex-start', gap: space[3] },
  tapes: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  tape: { paddingHorizontal: space[2], paddingVertical: space[1], transform: [{ rotate: '-2deg' }] },
  partner: { transform: [{ rotate: '1.5deg' }] },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 14, rowGap: space[2] },
  nameWrap: { flexShrink: 1 },
  name: { letterSpacing: -0.48 },
  plainName: { fontSize: 40, lineHeight: 40 },
  nameShadow: { position: 'absolute', top: 3, left: 3, right: -3 },
  logo: {
    position: 'absolute',
    left: space[4],
    bottom: -LOGO_OVERLAP,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderWidth: stroke.rule,
    borderColor: brand.ink,
    backgroundColor: brand.paper,
  },
  topRow: {
    position: 'absolute',
    left: space[4],
    right: space[4],
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  square: {
    width: size.tapMin,
    height: size.tapMin,
    backgroundColor: brand.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
});
