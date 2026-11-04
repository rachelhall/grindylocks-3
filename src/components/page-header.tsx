import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { HalftoneGround, HeaderArt } from '@/components/park-header';
import { StampTape } from '@/components/pages';
import type { Stamp } from '@/lib/pages';
import { brand, space, stroke, Text } from '@/theme';

/** Height of a page header, status bar included. Name-only pages get a shorter, plain one. */
export const PAGE_HEADER_HEIGHT = 300;
export const PLAIN_HEADER_HEIGHT = 228;
/** The logo tile overlaps the header's bottom edge by this much. */
export const LOGO_OVERLAP = 38;
const LOGO_SIZE = 76;

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
 * A managed page can add a header photo (Edit page, PR 7a): it's shown
 * with the park header's photocopy look and halftone, like a park photo.
 *
 * Founding partner is a paper tape beside the type tape. Like the park
 * header, it's dark in both themes, so it uses brand ink and paper. Back
 * and ⋯ are the pinned bar's tiles (`PinnedBar`), drawn over the header.
 */
export function PageHeader({
  name,
  tape,
  stamp,
  foundingPartner = false,
  logoUrl,
  photoUrl = null,
  plain = false,
  dim = false,
}: {
  name: string;
  /** "BRAND · SANTA ANA"; null for a name-only page. */
  tape: string | null;
  stamp: Stamp;
  foundingPartner?: boolean;
  /** Official pages only. */
  logoUrl: string | null;
  /** A managed page's header photo. */
  photoUrl?: string | null;
  plain?: boolean;
  dim?: boolean;
}) {
  const { t } = useTranslation();
  const height = plain ? PLAIN_HEADER_HEIGHT : PAGE_HEADER_HEIGHT;
  const { width } = useWindowDimensions();

  return (
    <View style={[styles.header, { height, paddingBottom: logoUrl ? LOGO_OVERLAP + 12 : 22 }]}>
      <View style={[StyleSheet.absoluteFill, styles.ground]}>
        {plain ? null : photoUrl && !dim ? (
          <HeaderArt photoUrl={photoUrl} width={width} height={height} />
        ) : (
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
});
