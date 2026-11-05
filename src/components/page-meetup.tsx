/**
 * Pages as meetup hosts (brand and shop accounts part A, PR 9). The
 * composer's pieces for pages (Shop-Meetup-Compose and the PageMeet-Place,
 * PageMeet-Dates, PageMeet-Capacity and PageMeet-Tickets boards) and the
 * meetup page's "Hosted by" strip (PageMeet-Page, PageMeet-Camp).
 *
 * - PlaceSheet: search parks, the page's own shop (when it shows a pin), an
 *   address with a pin (when the page has a city), and parks near the page.
 *   The address step warns never to use a home.
 * - DatesSheet: one day or several days (2 to 14 in a row), each with its
 *   own hours or the same every day, on the place's clock.
 * - CapacitySheet and TicketsSheet: the FOR PAGES rows' sheets.
 * - HostedBy: the ink strip under the meetup page's header.
 */
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';

import { PageTile, StampTape } from '@/components/pages';
import { Caption, Chip, type PickedPark, SearchBox, Sheet } from '@/components/tagging';
import { Button, Icon, type IconName, Toggle } from '@/components/ui';
import { usesMetric } from '@/i18n';
import { formatClock, localNow } from '@/lib/hours';
import { type DraftDay, type HostPage, MAX_CAPACITY, MAX_DAYS, MAX_TICKET_URL, zonedToUtc } from '@/lib/meetups';
import { isOfficial, type Page, pageKind } from '@/lib/pages';
import { distanceMeters, formatDistance, parksNear, useDirectorySearch } from '@/lib/parks';
import { fresh, keys } from '@/lib/query';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* Where a page's meetup can be -------------------------------------------------------- */

/** Whether a page can meet at its own shop: a storefront, or a by-appointment shop that shows its pin. */
export function pageHasPlace(page: Pick<Page, 'roles' | 'locationType' | 'showPin' | 'latitude'>): boolean {
  if (!page.roles.includes('shop') || page.latitude === null || !page.locationType) return false;
  return page.locationType === 'storefront' || (page.locationType === 'by_appointment' && page.showPin);
}

export type PickedAddress = { text: string; latitude: number; longitude: number };

export type PickedPlace =
  | { place: 'park'; park: PickedPark }
  | { place: 'page' }
  | { place: 'address'; address: PickedAddress };

const ADDRESS_MAX = 200;
const STREET = { latitudeDelta: 0.004, longitudeDelta: 0.004 };

function Row({
  icon,
  iconStyle,
  title,
  line,
  picked,
  chevron,
  onPress,
}: {
  icon: IconName;
  iconStyle: 'ink' | 'outline' | 'plain';
  title: string;
  line?: string | null;
  picked?: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(picked) }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.placeRow,
        { borderBottomColor: c.borderSubtle, backgroundColor: picked ? c.accentSubtle : c.surfaceRaised },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.placeIcon,
          iconStyle === 'ink' && { backgroundColor: brand.ink },
          iconStyle === 'outline' && { borderWidth: stroke.rule, borderColor: c.border },
          iconStyle === 'plain' && { backgroundColor: c.borderSubtle },
        ]}
      >
        <Icon name={icon} color={iconStyle === 'ink' ? brand.paper : c.text} size={22} />
      </View>
      <View style={styles.flex}>
        <Text variant="headline" numberOfLines={1} style={{ color: picked ? c.onAccentSubtle : c.text }}>
          {title}
        </Text>
        {line ? (
          <Text variant="bodySm" numberOfLines={2} style={{ color: picked ? c.onAccentSubtleSecondary : c.textSecondary }}>
            {line}
          </Text>
        ) : null}
      </View>
      {picked ? <Icon name="check" color={c.onAccentSubtle} size={22} /> : chevron ? <Icon name="chevron" color={c.textSecondary} size={20} /> : null}
    </Pressable>
  );
}

/**
 * Place (PageMeet-Place): a park, the page's own shop, or an address. Only
 * pages see this; people keep the park picker.
 */
export function PlaceSheet({
  visible,
  page,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  page: Page;
  current: PickedPlace | null;
  onPick: (next: PickedPlace) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const [q, setQ] = useState('');
  const [step, setStep] = useState<'list' | 'address'>('list');
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setQ('');
      setStep(current?.place === 'address' ? 'address' : 'list');
    }
  }
  const searching = q.trim().length >= 2;
  const search = useDirectorySearch(q);
  const results = searching ? (search.data ?? []).filter((r) => r.kind === 'park') : [];
  const hasPin = page.latitude !== null && page.longitude !== null;
  const near = useQuery({
    queryKey: keys.parksNear(page.latitude ?? 0, page.longitude ?? 0, 5),
    queryFn: () => parksNear(page.latitude!, page.longitude!, 5),
    enabled: visible && hasPin,
    staleTime: fresh.parks,
  });
  const shopRow = pageHasPlace(page);
  // An address needs the page's metro area (its clock and city admin).
  const canAddress = Boolean(page.metroAreaId);
  const name = page.displayName;

  const pick = (next: PickedPlace) => {
    onPick(next);
    onClose();
  };

  if (step === 'address') {
    return (
      <AddressStep
        visible={visible}
        page={page}
        initial={current?.place === 'address' ? current.address : null}
        onBack={() => setStep('list')}
        onClose={onClose}
        onPick={(address) => pick({ place: 'address', address })}
      />
    );
  }

  const parkLine = (p: { park_type?: string; city?: string; distance_m?: number; latitude?: number; longitude?: number }) => {
    const type = p.park_type ? t(`park.type.${p.park_type}` as 'park.type.skatepark') : null;
    const meters =
      p.distance_m ??
      (hasPin && p.latitude !== undefined && p.longitude !== undefined
        ? distanceMeters({ latitude: page.latitude!, longitude: page.longitude! }, { latitude: p.latitude, longitude: p.longitude })
        : null);
    return [type, meters !== null && meters !== undefined ? formatDistance(meters, usesMetric(), i18n.language) : p.city].filter(Boolean).join(' · ');
  };

  return (
    <Sheet visible={visible} title={t('pageMeet.placeTitle')} onClose={onClose}>
      <SearchBox value={q} onChangeText={setQ} placeholder={t('pageMeet.searchParks')} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetList}>
        {searching ? (
          <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
            {results.map((r) => (
              <Row
                key={r.id}
                icon="pin"
                iconStyle="plain"
                title={r.name}
                line={r.detail}
                picked={current?.place === 'park' && current.park.id === r.id}
                onPress={() => pick({ place: 'park', park: { id: r.id, name: r.name } })}
              />
            ))}
          </View>
        ) : (
          <>
            {shopRow ? (
              <>
                <View style={styles.caption}>
                  <Caption>{t('pageMeet.yourShop')}</Caption>
                </View>
                <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
                  <Row
                    icon="storefront"
                    iconStyle="ink"
                    title={t('pageMeet.theShop', { name })}
                    line={[page.address, page.city].filter(Boolean).join(', ')}
                    picked={current?.place === 'page'}
                    onPress={() => pick({ place: 'page' })}
                  />
                </View>
              </>
            ) : null}
            {canAddress ? (
              <>
                <View style={styles.caption}>
                  <Caption>{t('pageMeet.somewhereElse')}</Caption>
                </View>
                <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
                  <Row
                    icon="editLocation"
                    iconStyle="outline"
                    title={current?.place === 'address' ? current.address.text : t('pageMeet.anAddress')}
                    line={t('pageMeet.anAddressBody')}
                    picked={current?.place === 'address'}
                    chevron
                    onPress={() => setStep('address')}
                  />
                </View>
              </>
            ) : null}
            {hasPin && (near.data ?? []).length > 0 ? (
              <>
                <View style={styles.caption}>
                  <Caption>{t('pageMeet.parksNear', { name })}</Caption>
                </View>
                <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
                  {(near.data ?? []).map((p) => (
                    <Row
                      key={p.id}
                      icon="pin"
                      iconStyle="plain"
                      title={p.display_name}
                      line={parkLine(p)}
                      picked={current?.place === 'park' && current.park.id === p.id}
                      onPress={() => pick({ place: 'park', park: { id: p.id, name: p.display_name } })}
                    />
                  ))}
                </View>
              </>
            ) : null}
            <Text variant="bodySm" color="textSecondary" style={styles.note}>
              {canAddress ? t('pageMeet.addressWarning') : t('pageMeet.noCityForAddress', { name })}
            </Text>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

/** An address and its pin: type it, find it, then move the map under the pin. */
function AddressStep({
  visible,
  page,
  initial,
  onBack,
  onClose,
  onPick,
}: {
  visible: boolean;
  page: Page;
  initial: PickedAddress | null;
  onBack: () => void;
  onClose: () => void;
  onPick: (address: PickedAddress) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const mapRef = useRef<MapView>(null);
  const start = initial ?? (page.latitude !== null && page.longitude !== null ? { latitude: page.latitude, longitude: page.longitude } : null);
  const [text, setText] = useState(initial?.text ?? '');
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(initial ? { latitude: initial.latitude, longitude: initial.longitude } : null);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async () => {
    const query = [text.trim(), page.city].filter(Boolean).join(', ');
    if (!query) return;
    setError(null);
    setFinding(true);
    try {
      if (Platform.OS === 'android') {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          setError(t('pageAddress.lookupNeedsLocation'));
          return;
        }
      }
      const [hit] = await Location.geocodeAsync(query);
      if (!hit) {
        setError(t('pageAddress.notFound'));
        return;
      }
      const p = { latitude: hit.latitude, longitude: hit.longitude };
      setPin(p);
      mapRef.current?.animateToRegion({ ...p, ...STREET }, 400);
    } catch (err) {
      Sentry.captureException(err);
      setError(t('pageAddress.notFound'));
    } finally {
      setFinding(false);
    }
  };

  const onRegionChangeComplete = (r: Region) => {
    if (r.latitudeDelta > 1) return;
    setPin({ latitude: r.latitude, longitude: r.longitude });
  };

  const ready = text.trim().length > 0 && pin !== null;

  return (
    <Sheet visible={visible} title={t('pageMeet.addressTitle')} onClose={onClose} onBack={onBack}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
        <TextInput
          value={text}
          onChangeText={(v) => setText(v.slice(0, ADDRESS_MAX))}
          placeholder={t('pageMeet.addressPlaceholder')}
          placeholderTextColor={c.textSecondary}
          maxLength={ADDRESS_MAX}
          autoComplete="street-address"
          textContentType="fullStreetAddress"
          accessibilityLabel={t('pageMeet.addressTitle')}
          returnKeyType="search"
          onSubmitEditing={() => void find()}
          style={[styles.input, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
        />
        <Button variant="secondary" icon="search" label={t('pageAddress.find')} onPress={() => void find()} loading={finding} disabled={!text.trim()} />
        <View style={[styles.map, { borderColor: c.border }]} accessible accessibilityLabel={pin ? t('pageAddress.mapLabel') : t('pageAddress.mapLabelEmpty')}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={start ? { ...start, ...STREET } : { latitude: 20, longitude: 0, latitudeDelta: 120, longitudeDelta: 160 }}
            onRegionChangeComplete={onRegionChangeComplete}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            showsPointsOfInterests={false}
          />
          <View pointerEvents="none" style={styles.pinWrap}>
            <View style={[styles.pin, { borderColor: brand.paper }]}>
              <Icon name="pin" color={brand.paper} size={20} />
            </View>
            <View style={styles.pinTip} />
          </View>
          <View pointerEvents="none" style={[styles.hint, { backgroundColor: brand.ink }]}>
            <Text variant="bodySm" style={{ color: brand.paper, fontFamily: fontFamily.sansSemiBold }}>
              {pin ? t('pageAddress.moveMap') : t('pageAddress.findFirst')}
            </Text>
          </View>
        </View>
        <Text variant="bodySm" color="textSecondary">
          {t('pageMeet.addressWarning')}
        </Text>
        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button
          label={t('pageMeet.useAddress')}
          disabled={!ready}
          onPress={() => pin && onPick({ text: text.trim(), latitude: pin.latitude, longitude: pin.longitude })}
        />
      </ScrollView>
    </Sheet>
  );
}

/* Dates ---------------------------------------------------------------------------- */

type Ymd = { year: number; month: number; day: number };
type Hours = { start: string; end: string };

const addDays = (d: Ymd, n: number): Ymd => {
  const x = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() };
};
const sameDay = (a: Ymd, b: Ymd) => a.year === b.year && a.month === b.month && a.day === b.day;
const dayIndex = (d: Ymd) => Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;

/** "18:00" or "6:30 pm" to minutes past midnight, or null. */
export function parseClock(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith('p') && h !== 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
  } else if (h > 24 || (h === 24 && min > 0)) return null;
  return (h % 24) * 60 + min;
}

const clockText = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Dates (PageMeet-Dates): One day keeps the composer's Starts and Ends;
 * Several days picks the first and last day and each day's hours (or the
 * same every day), on the place's clock. Up to 14 days, no repeats.
 */
export function DatesSheet({
  visible,
  timeZone,
  value,
  fixed = false,
  onChange,
  onClose,
}: {
  visible: boolean;
  timeZone: string | null;
  /** The days picked, or null for one day. */
  value: DraftDay[] | null;
  /** Editing a meetup over several days: it stays several days (the database changes it by its days). */
  fixed?: boolean;
  onChange: (days: DraftDay[] | null) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const locale = i18n.language;
  const [today, setToday] = useState<Ymd>(() => localNow(new Date(), timeZone));
  const [several, setSeveral] = useState(false);
  const [first, setFirst] = useState<Ymd>(today);
  const [count, setCount] = useState(2);
  const [same, setSame] = useState(false);
  const [hours, setHours] = useState<Hours[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      const now = localNow(new Date(), timeZone);
      setToday(now);
      setError(null);
      if (value && value.length >= 2) {
        const f = localNow(value[0].startsAt, timeZone);
        setSeveral(true);
        setFirst(f);
        setCount(value.length);
        const hs = value.map((d) => ({
          start: clockText(localNow(d.startsAt, timeZone).minutes),
          end: clockText(localNow(d.endsAt, timeZone).minutes),
        }));
        setHours(hs);
        setSame(hs.every((h) => h.start === hs[0].start && h.end === hs[0].end));
      } else {
        setSeveral(false);
        setFirst(now);
        setCount(2);
        setSame(false);
        setHours([]);
      }
    }
  }

  const dayLabel = (d: Ymd) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(d.year, d.month - 1, d.day)),
    );
  const firstChoices = useMemo(() => Array.from({ length: 120 }, (_, i) => addDays(today, i)), [today]);
  const last = addDays(first, count - 1);
  const lastChoices = Array.from({ length: MAX_DAYS - 1 }, (_, i) => addDays(first, i + 1));
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  const hoursFor = (i: number): Hours => (same ? hours[0] : hours[i]) ?? hours[0] ?? { start: '10:00', end: '18:00' };
  const setHoursFor = (i: number, patch: Partial<Hours>) =>
    setHours((hs) => {
      const next = days.map((_, j) => hs[j] ?? hs[0] ?? { start: '10:00', end: '18:00' });
      if (same) return next.map((h) => ({ ...h, ...patch }));
      next[i] = { ...next[i], ...patch };
      return next;
    });

  const done = () => {
    if (!several) {
      onChange(null);
      onClose();
      return;
    }
    const out: DraftDay[] = [];
    for (let i = 0; i < days.length; i++) {
      const h = hoursFor(i);
      const s = parseClock(h.start);
      const e = parseClock(h.end);
      if (s === null || e === null || s === e) {
        setError(t('pageMeet.dayEnds', { day: dayLabel(days[i]) }));
        return;
      }
      const d = days[i];
      const startsAt = zonedToUtc(d.year, d.month, d.day, s, timeZone);
      // An end before the start runs past midnight.
      const endDay = e < s ? addDays(d, 1) : d;
      const endsAt = zonedToUtc(endDay.year, endDay.month, endDay.day, e, timeZone);
      out.push({ startsAt, endsAt });
    }
    onChange(out);
    onClose();
  };

  const timeInput = (i: number, which: 'start' | 'end', day: Ymd) => (
    <TextInput
      value={hoursFor(i)[which]}
      onChangeText={(v) => setHoursFor(i, { [which]: v.slice(0, 8) })}
      onEndEditing={(e) => {
        const m = parseClock(e.nativeEvent.text);
        if (m !== null) setHoursFor(i, { [which]: clockText(m) });
      }}
      keyboardType="numbers-and-punctuation"
      maxLength={8}
      accessibilityLabel={t(which === 'start' ? 'pageMeet.dayStarts' : 'pageMeet.dayEnds', { day: dayLabel(day) })}
      style={[styles.time, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
    />
  );

  return (
    <Sheet visible={visible} title={t('pageMeet.datesTitle')} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
        {fixed ? null : (
        <View accessibilityRole="tablist" style={[styles.switch, { borderColor: c.border }]}>
          {([false, true] as const).map((on) => {
            const picked = several === on;
            return (
              <Pressable
                key={String(on)}
                accessibilityRole="tab"
                accessibilityState={{ selected: picked }}
                onPress={() => {
                  setSeveral(on);
                  setError(null);
                }}
                style={[styles.switchTab, { backgroundColor: picked ? c.text : 'transparent' }]}
              >
                <Text variant="body" style={{ color: picked ? c.surface : c.text, fontFamily: fontFamily.sansSemiBold }}>
                  {on ? t('pageMeet.severalDays') : t('pageMeet.oneDay')}
                </Text>
              </Pressable>
            );
          })}
        </View>
        )}

        {several ? (
          <>
            <Caption>{t('pageMeet.firstDay')}</Caption>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {firstChoices.map((d) => (
                <Chip
                  key={dayIndex(d)}
                  label={sameDay(d, today) ? t('meetupCompose.today') : dayLabel(d)}
                  picked={sameDay(d, first)}
                  onPress={() => setFirst(d)}
                />
              ))}
            </ScrollView>
            <Caption>{t('pageMeet.lastDay')}</Caption>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {lastChoices.map((d, i) => (
                <Chip key={dayIndex(d)} label={dayLabel(d)} picked={sameDay(d, last)} onPress={() => setCount(i + 2)} />
              ))}
            </ScrollView>
            <View style={[styles.switchRow, { borderBottomColor: c.borderSubtle }]}>
              <Icon name="clock" color={c.text} size={22} />
              <Text variant="headline" style={styles.flex}>
                {t('pageMeet.sameTimes')}
              </Text>
              <Toggle value={same} onChange={setSame} label={t('pageMeet.sameTimes')} fg={c.text} />
            </View>
            <Caption>{t('pageMeet.eachDay')}</Caption>
            {(same ? days.slice(0, 1) : days).map((d, i) => (
              <View key={dayIndex(d)} style={styles.dayRow}>
                <Text variant="body" style={[styles.flex, { fontFamily: fontFamily.sansSemiBold }]}>
                  {same ? t('pageMeet.dayRange', { from: dayLabel(first), to: dayLabel(last) }) : dayLabel(d)}
                </Text>
                {timeInput(i, 'start', d)}
                <Text variant="body" importantForAccessibility="no">
                  –
                </Text>
                {timeInput(i, 'end', d)}
              </View>
            ))}
            {timeZone ? (
              <Text variant="caption" color="textSecondary">
                {t('meetupCompose.parkClock')}
              </Text>
            ) : null}
          </>
        ) : null}

        <Text variant="bodySm" color="textSecondary">
          {t('pageMeet.daysNote')}
        </Text>
        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('pageMeet.done')} onPress={done} palette={{ fill: c.accent, text: c.onAccent, border: c.onAccent }} />
      </ScrollView>
    </Sheet>
  );
}

/** "Fri, Dec 4 – Sun, Dec 6", on the place's clock. */
export function daysRangeLabel(first: Date, last: Date, timeZone: string | null, locale: string, t: (k: 'pageMeet.dayRange', o: { from: string; to: string }) => string) {
  const f = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timeZone ?? undefined });
  return t('pageMeet.dayRange', { from: f.format(first), to: f.format(last) });
}

/** A day's hours, "18:00–22:00", on the place's clock. */
export function dayHours(startsAt: Date, endsAt: Date, timeZone: string | null, locale: string) {
  return `${formatClock(localNow(startsAt, timeZone).minutes, locale)}–${formatClock(localNow(endsAt, timeZone).minutes, locale)}`;
}

/* Capacity ------------------------------------------------------------------------- */

export function CapacitySheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: number | null;
  onChange: (next: number | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [text, setText] = useState('');
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setText(String(value ?? 30));
  }
  const n = Math.min(MAX_CAPACITY, Math.max(1, Number.parseInt(text, 10) || 0));
  const step = (d: number) => setText(String(Math.min(MAX_CAPACITY, Math.max(1, (Number.parseInt(text, 10) || 0) + d))));

  return (
    <Sheet visible={visible} title={t('pageMeet.capacityTitle')} onClose={onClose}>
      <View style={styles.sheetBody}>
        <Text variant="bodySm" color="textSecondary">
          {t('pageMeet.capacityBody')}
        </Text>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('pageMeet.fewer')}
            onPress={() => step(-1)}
            style={({ pressed }) => [styles.step, { borderColor: c.border, backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
          >
            <Icon name="minus" color={c.text} size={24} />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.replace(/\D/g, '').slice(0, 5))}
            keyboardType="number-pad"
            accessibilityLabel={t('pageMeet.spots')}
            style={[styles.count, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('pageMeet.more')}
            onPress={() => step(1)}
            style={({ pressed }) => [styles.step, { borderColor: c.border, backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
          >
            <Icon name="add" color={c.text} size={24} />
          </Pressable>
        </View>
        <Text variant="bodySm" color="textSecondary" style={styles.center}>
          {t('pageMeet.spotsHint')}
        </Text>
        <Button
          label={t('pageMeet.noLimit')}
          variant="secondary"
          onPress={() => {
            onChange(null);
            onClose();
          }}
        />
        <Button
          label={t('pageMeet.done')}
          disabled={!text}
          onPress={() => {
            onChange(n);
            onClose();
          }}
          palette={{ fill: c.accent, text: c.onAccent, border: c.onAccent }}
        />
      </View>
    </Sheet>
  );
}

/* Tickets -------------------------------------------------------------------------- */

export const isTicketUrl = (u: string) => /^https:\/\/\S+$/.test(u.trim()) && u.trim().length <= MAX_TICKET_URL;

export function TicketsSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setText(value || 'https://');
      setError(false);
    }
  }
  const done = () => {
    const u = text.trim();
    if (u === '' || u === 'https://') {
      onChange('');
      return onClose();
    }
    if (!isTicketUrl(u)) return setError(true);
    onChange(u);
    onClose();
  };

  return (
    <Sheet visible={visible} title={t('pageMeet.ticketsTitle')} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
        <Text variant="bodySm" color="textSecondary">
          {t('pageMeet.ticketsBody')}
        </Text>
        <Text variant="label" color="textSecondary">
          {t('pageMeet.ticketLink')}
        </Text>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v.slice(0, MAX_TICKET_URL));
            setError(false);
          }}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="URL"
          accessibilityLabel={t('pageMeet.ticketLink')}
          style={[styles.input, { borderColor: error ? c.statusClosed : c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
        />
        <Text variant="bodySm" color={error ? 'statusClosed' : 'textSecondary'} accessibilityLiveRegion="polite">
          {error ? t('pageMeet.badLink') : t('pageMeet.startsWithHttps')}
        </Text>
        <Text variant="label" color="textSecondary">
          {t('pageMeet.onTheMeetup')}
        </Text>
        <View style={[styles.ticketPreview, { borderColor: c.border, backgroundColor: c.accent }]} accessibilityElementsHidden importantForAccessibility="no">
          <Text variant="body" style={{ color: c.onAccent, fontFamily: fontFamily.sansSemiBold }}>
            {t('pageMeet.getTickets')}
          </Text>
          <Icon name="external" color={c.onAccent} size={18} />
        </View>
        {value ? (
          <Button
            label={t('pageMeet.removeLink')}
            variant="secondary"
            onPress={() => {
              onChange('');
              onClose();
            }}
          />
        ) : null}
        <Button label={t('pageMeet.done')} onPress={done} palette={{ fill: c.accent, text: c.onAccent, border: c.onAccent }} />
      </ScrollView>
    </Sheet>
  );
}

/* Hosted by ------------------------------------------------------------------------ */

/**
 * The ink strip under the meetup page's header: the page's logo, HOSTED BY
 * (or HOSTED BY THE PARK when it's the park's own page), the name, OFFICIAL
 * and SHOP or BRAND. Opens the page.
 */
export function HostedBy({ page, ofThePark }: { page: HostPage; ofThePark: boolean }) {
  const { t } = useTranslation();
  const official = isOfficial({ state: page.state, logoPath: page.logo_path });
  const tile = { displayName: page.display_name, state: page.state, logoPath: page.logo_path };
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('pageMeet.hostedByA11y', { name: page.display_name })}
      onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: page.handle } })}
      style={({ pressed }) => [styles.hosted, { backgroundColor: brand.ink }, pressed && styles.pressed]}
    >
      <View style={[styles.logoRing, { borderColor: brand.paper }]}>
        <PageTile page={tile} size={32} />
      </View>
      <View style={styles.flex}>
        <Text variant="label" style={{ color: brand.paper, opacity: 0.75 }}>
          {ofThePark ? t('pageMeet.hostedByPark') : t('pageMeet.hostedBy')}
        </Text>
        <View style={styles.nameRow}>
          <Text variant="headline" numberOfLines={1} style={[styles.shrink, { color: brand.paper }]}>
            {page.display_name}
          </Text>
          {official ? <StampTape stamp="official" small /> : null}
          {ofThePark ? null : (
            <Text variant="label" style={{ color: brand.paper, opacity: 0.75 }}>
              {t(`page.${pageKind(page)}`)}
            </Text>
          )}
        </View>
      </View>
      <Icon name="chevron" color={brand.paper} size={22} />
    </Pressable>
  );
}

/** The 18+ chip: ink on paper, like a label. */
export function AdultsChip({ small }: { small?: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[small ? styles.chipSmall : styles.chip, { backgroundColor: c.text, borderColor: c.text }]}>
      <Text variant="caption" style={{ color: c.surface, fontFamily: fontFamily.sansSemiBold }}>
        {t('pageMeet.adults')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.75 },
  sheetList: { paddingBottom: space[4] },
  sheetBody: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3] },
  caption: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[2] },
  rows: { borderTopWidth: stroke.hairline },
  note: { paddingHorizontal: space[4], paddingTop: space[3] },
  placeRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderBottomWidth: stroke.hairline,
  },
  placeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 52, borderWidth: stroke.rule, paddingHorizontal: space[3], fontFamily: fontFamily.sans, fontSize: 16 },
  map: { height: 240, borderWidth: stroke.rule, overflow: 'hidden' },
  pinWrap: { position: 'absolute', left: '50%', top: '50%', marginLeft: -18, marginTop: -46, alignItems: 'center' },
  pin: { width: 36, height: 36, backgroundColor: brand.ink, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  pinTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: brand.ink,
  },
  hint: { position: 'absolute', left: 10, top: 10, right: 10, paddingHorizontal: 10, paddingVertical: 8 },
  switch: { flexDirection: 'row', borderWidth: stroke.rule },
  switchTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: space[2], paddingVertical: 2 },
  switchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[3], borderBottomWidth: stroke.hairline },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  time: {
    width: 84,
    minHeight: size.tapMin,
    borderWidth: stroke.rule,
    paddingHorizontal: space[2],
    textAlign: 'center',
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 16,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  step: { width: 52, height: 52, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  count: {
    flex: 1,
    minWidth: 0,
    height: 52,
    borderWidth: stroke.rule,
    textAlign: 'center',
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 22,
  },
  ticketPreview: { minHeight: size.tapMin, borderWidth: stroke.rule, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2] },
  hosted: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2], marginHorizontal: space[4] },
  logoRing: { borderWidth: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  chip: { borderWidth: 1, paddingHorizontal: space[2], paddingVertical: 2 },
  chipSmall: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
});
