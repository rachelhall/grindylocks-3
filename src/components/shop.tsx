/**
 * A shop page's own sections (part A, PR 3), per the Shop-8SET and
 * Shop-TempClosed mockups: the address with the open-now and location-type
 * chips, the square Directions and link buttons beside Follow, the hours
 * card on the shop's own clock (greyed under "Closed until"), and Brands we
 * carry with "+N more".
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { openDirections, StatusChip } from '@/components/parks';
import { Icon, type IconName } from '@/components/ui';
import { formatClock } from '@/lib/hours';
import { type CarriedBrand, linkKind, linkUrl, type Page } from '@/lib/pages';
import { shopOpenState, timeZoneCity, weekLines } from '@/lib/shops';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/** Where a shop is, if it says: by-appointment shops without a pin show the city only. */
export function shopAddress(page: Page): string | null {
  if (page.locationType === 'online_only') return null;
  if (page.locationType === 'by_appointment' && !page.showPin) return null;
  return page.address;
}

/** Directions only go somewhere the shop has chosen to show. */
export function shopHasDirections(page: Page): boolean {
  if (page.locationType === 'online_only') return false;
  if (page.locationType === 'by_appointment' && !page.showPin) return false;
  return page.latitude !== null || Boolean(page.address);
}

/** "Closed until Jan 7", or "Closed for now" with no date. */
export function useClosedUntilLabel() {
  const { t, i18n } = useTranslation();
  return (until: string | null) =>
    until
      ? t('page.closedUntil', {
          date: new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
            new Date(`${until}T00:00:00Z`),
          ),
        })
      : t('page.closedForNow');
}

/** The amber "Closed until" chip (the `warning` token). */
export function ClosedUntilChip({ until }: { until: string | null }) {
  const c = useColors();
  const label = useClosedUntilLabel();
  return (
    <View style={[styles.chip, { borderColor: c.warning }]}>
      <Text variant="label" style={{ color: c.warning }}>
        {label(until).toUpperCase()}
      </Text>
    </View>
  );
}

/** The address, then open now (or Closed until) and how people visit. */
export function ShopPlace({ page }: { page: Page }) {
  const { t } = useTranslation();
  const c = useColors();
  const address = shopAddress(page);
  const state = shopOpenState(page);
  return (
    <View style={styles.place}>
      {address ? (
        <Text variant="bodySm" color="textSecondary">
          {address}
        </Text>
      ) : null}
      <View style={styles.chips}>
        {page.tempClosedAt ? <ClosedUntilChip until={page.tempClosedUntil} /> : <StatusChip state={state} />}
        {page.locationType ? (
          <View style={[styles.chip, { borderColor: c.textSecondary }]}>
            <Text variant="label" color="textSecondary">
              {t(`shop.type.${page.locationType}`).toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Square buttons beside Follow: Directions, then the page's links. */
export function ShopButtons({ page, links }: { page: Page; links: string[] }) {
  const { t } = useTranslation();
  return (
    <>
      {shopHasDirections(page) ? (
        <SquareButton
          icon="directions"
          label={t('shop.directions')}
          onPress={() =>
            openDirections({
              latitude: page.latitude,
              longitude: page.longitude,
              display_name: page.displayName,
              address: page.address,
            })
          }
        />
      ) : null}
      {links.map((url) => {
        const kind = linkKind(url);
        const icon: IconName = kind === 'instagram' ? 'photoCamera' : kind === 'youtube' ? 'playCircle' : 'globe';
        return (
          <SquareButton
            key={url}
            icon={icon}
            label={t(`page.${kind}`)}
            hint={url}
            link
            onPress={() => void Linking.openURL(linkUrl(url)).catch(() => Alert.alert(t('errors.generic')))}
          />
        );
      })}
    </>
  );
}

function SquareButton({
  icon,
  label,
  hint,
  link,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  link?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole={link ? 'link' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.square, { borderColor: c.border }, pressed && styles.pressed]}
    >
      <Icon name={icon} color={c.text} size={20} />
    </Pressable>
  );
}

/**
 * The week's hours on the shop's own clock, days with the same hours run
 * together. While the shop is closed for a while they're its usual hours,
 * greyed. A storefront with no hours yet shows nothing.
 */
export function ShopHours({ page }: { page: Page }) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  if (page.locationType !== 'storefront' || page.hours.length === 0) return null;
  const locale = i18n.language;
  const lines = weekLines(page.hours, page.timeZone);
  const city = page.city ?? timeZoneCity(page.timeZone);
  const usual = Boolean(page.tempClosedAt);
  const dayName = (d: number, style: 'short' | 'long') =>
    // 2026-01-05 was a Monday.
    new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d)));
  const days = (from: number, to: number) =>
    from === 1 && to === 7
      ? t('park.daily')
      : from === to
        ? dayName(from, 'long')
        : t('shop.dayRange', { from: dayName(from, 'short'), to: dayName(to, 'short') });
  const title = city
    ? t(usual ? 'shop.usualHoursIn' : 'shop.hoursIn', { city })
    : t(usual ? 'shop.usualHours' : 'shop.hours');
  return (
    <View style={[styles.card, { backgroundColor: c.surfaceRaised }]} accessibilityRole="summary">
      <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.cardTitle}>
        {title.toUpperCase()}
      </Text>
      {lines.map((line, i) => {
        const time =
          line.spans.length === 0
            ? t('shop.closed')
            : line.spans
                .map((s) => t('park.timeRange', { start: formatClock(s.start, locale), end: formatClock(s.end, locale) }))
                .join(', ');
        return (
          <View
            key={line.from}
            style={[
              styles.hoursRow,
              i < lines.length - 1 && { borderBottomWidth: stroke.hairline, borderBottomColor: c.borderSubtle },
            ]}
          >
            <Text variant="body" color={usual ? 'textSecondary' : 'text'} style={styles.flex}>
              {days(line.from, line.to)}
            </Text>
            <Text
              variant="body"
              color={usual ? 'textSecondary' : 'text'}
              style={usual || line.spans.length === 0 ? undefined : { fontFamily: fontFamily.sansSemiBold }}
            >
              {time}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** How many brand chips show before "+N more". */
const BRANDS_SHOWN = 6;

/** "Brands we carry": chips that open each brand's page, then "+N more". */
export function BrandsCarried({ brands }: { brands: CarriedBrand[] }) {
  const { t } = useTranslation();
  const c = useColors();
  const [all, setAll] = useState(false);
  if (brands.length === 0) return null;
  const shown = all || brands.length <= BRANDS_SHOWN + 1 ? brands : brands.slice(0, BRANDS_SHOWN);
  const hidden = brands.length - shown.length;
  return (
    <View style={styles.section}>
      <Text variant="title" accessibilityRole="header">
        {t('shop.brandsWeCarry')}
      </Text>
      <View style={styles.brandChips}>
        {shown.map((b) => (
          <Pressable
            key={b.id}
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: b.handle } })}
            style={({ pressed }) => [
              styles.brand,
              { borderColor: c.border, backgroundColor: c.surfaceRaised },
              pressed && styles.pressed,
            ]}
          >
            <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {b.displayName}
            </Text>
          </Pressable>
        ))}
        {hidden > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('shop.moreBrandsLabel', { count: hidden })}
            onPress={() => setAll(true)}
            style={({ pressed }) => [
              styles.brand,
              styles.more,
              { borderColor: c.border, backgroundColor: c.surfaceRaised },
              pressed && styles.pressed,
            ]}
          >
            <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {t('shop.moreBrands', { count: hidden })}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  place: { paddingHorizontal: space[4], paddingTop: 14, gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { borderWidth: stroke.rule, paddingHorizontal: space[2], paddingVertical: space[1] },
  square: {
    width: size.tapMin,
    height: size.tapMin,
    borderWidth: stroke.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { marginHorizontal: space[4], marginTop: space[4], padding: space[3] },
  cardTitle: { paddingBottom: space[1] },
  hoursRow: { flexDirection: 'row', gap: space[3], paddingVertical: 6 },
  section: { paddingHorizontal: space[4], paddingTop: space[6], gap: 10 },
  brandChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  brand: { minHeight: 36, borderWidth: stroke.rule, paddingHorizontal: 10, justifyContent: 'center' },
  more: { borderStyle: 'dashed' },
});
