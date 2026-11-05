import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { EmptyState } from '@/components/empty-state';
import { PageRow, SuggestPageBox } from '@/components/pages';
import { ParkRow, useParkLine } from '@/components/parks';
import { RecentSearchRows, SectionHead, SkaterRow } from '@/components/suggestions';
import { Button, Icon } from '@/components/ui';
import { countryName, usesMetric } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { type PageResult, searchPages } from '@/lib/pages';
import { type PersonResult, searchPeople } from '@/lib/people';
import {
  distanceMeters,
  formatDistance,
  parkCoords,
  type ParkPin,
  parksNear,
  type SearchResult,
  searchDirectory,
  showMetroOnMap,
  useMetro,
  useParksByIds,
  useParksInMetro,
  useSavedParks,
} from '@/lib/parks';
import { fresh, keys } from '@/lib/query';
import { useRecentSearches, useSkatersAtYourParks, useSkatersInMetro } from '@/lib/suggestions';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

type Filter = 'all' | 'people' | 'parks' | 'pages';
type Point = { latitude: number; longitude: number };
type Results = {
  people: PersonResult[];
  /** Cities (metro areas) whose name, or a town inside them, matches. */
  places: SearchResult[];
  parks: SearchResult[];
  pages: PageResult[];
  coords: Map<string, Point>;
  failed: boolean;
};

const MIN_CHARS = 2;

const asFilter = (v: string | undefined): Filter | null =>
  v === 'all' || v === 'people' || v === 'parks' || v === 'pages' ? v : null;

type Located = { state: 'on' | 'off'; here: Point | null };

/** Whether location is allowed and, if so, where the phone is. `ask` shows the prompt (or Settings). */
async function readLocation(ask: boolean): Promise<Located> {
  let perm = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (perm && !perm.granted && ask) {
    if (!perm.canAskAgain) {
      void Linking.openSettings();
      return { state: 'off', here: null };
    }
    perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
  }
  if (!perm?.granted) return { state: 'off', here: null };
  const pos =
    (await Location.getLastKnownPositionAsync().catch(() => null)) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
  return { state: 'on', here: pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : null };
}
const DEBOUNCE_MS = 250;

/**
 * Search tab (Nov 1): one box for people, parks and brand and shop pages, an
 * All / People / Parks / Pages switch, and results grouped by type. People
 * match on username; parks on display name, official name, aliases and
 * city; pages on handle, name and "Formerly" names, all accent-insensitive. Under
 * the results (All and Pages), "Can't find a brand or shop? Suggest it"
 * (Search-Pages mockup, v2). Places (Nov 5): a city that matches shows as
 * "Copenhagen, Denmark · 12 parks" above the parks, and opens the Map tab on
 * that city, the same result as the map's own city search.
 */
export default function Search() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const { saved, toggle } = useSavedParks(session?.user.id);

  const [q, setQ] = useState('');
  // Home's "Find skaters" opens Search on People.
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<Filter>(() => asFilter(filterParam) ?? 'all');
  const [seenParam, setSeenParam] = useState(filterParam);
  if (filterParam !== seenParam) {
    setSeenParam(filterParam);
    const next = asFilter(filterParam);
    if (next) setFilter(next);
  }
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);
  const [here, setHere] = useState<Point | null>(null);
  // 'off' until location is allowed: the idle screen then offers to turn it on.
  const [locationState, setLocationState] = useState<'checking' | 'on' | 'off'>('checking');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef('');
  const recent = useRecentSearches(session?.user.id);

  // Distances only when location is already allowed; Search only asks when
  // the member taps Turn on location.
  const apply = useCallback((found: Located) => {
    setLocationState(found.state);
    if (found.here) setHere(found.here);
  }, []);
  const locate = useCallback(async (ask: boolean) => apply(await readLocation(ask)), [apply]);

  useEffect(() => {
    let cancelled = false;
    void readLocation(false).then((found) => {
      if (!cancelled) apply(found);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Searches 250 ms after typing stops; late answers to old queries are dropped.
  function onChangeQuery(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    const query = value.trim();
    latest.current = query;
    if (query.replace(/^@+/, '').length < MIN_CHARS) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(() => void run(query), DEBOUNCE_MS);
  }

  /** Opening a result remembers what was typed (on the phone only). */
  function remember() {
    recent.add(q);
  }

  function searchAgain(text: string) {
    onChangeQuery(text);
    recent.add(text);
  }

  async function run(query: string) {
    let failed = false;
    const [people, directory, pages] = await Promise.all([
      searchPeople(query).catch(() => {
        failed = true;
        return [] as PersonResult[];
      }),
      // A leading "@" means a username; don't send it to the park search.
      searchDirectory(query.replace(/^@+/, '')).catch(() => {
        failed = true;
        return [] as SearchResult[];
      }),
      searchPages(query).catch(() => {
        failed = true;
        return [] as PageResult[];
      }),
    ]);
    const places = directory.filter((r) => r.kind === 'metro');
    const parks = directory.filter((r) => r.kind === 'park');
    // Coordinates come separately, so distances can show once location arrives.
    const coords = await parkCoords(parks.map((p) => p.id)).catch(() => new Map<string, Point>());
    if (latest.current !== query) return;
    setResults({ people, places, parks, pages, coords, failed });
    setSearching(false);
  }

  function describePerson(p: PersonResult) {
    const disciplines = p.disciplines.map((d) => t(`disciplines.${d}`)).join(', ');
    const home = p.home_park_name ? [p.home_park_name, p.home_metro_name].filter(Boolean).join(', ') : p.home_metro_name;
    return [disciplines, home].filter(Boolean).join(' · ');
  }

  function describePark(p: SearchResult) {
    const at = here ? results?.coords.get(p.id) : undefined;
    return [
      p.detail,
      t(`park.type.${p.park_type}`),
      at && here ? formatDistance(distanceMeters(here, at), usesMetric(), i18n.language) : null,
      p.matched_alias ? t('search.alsoKnownAs', { name: p.matched_alias }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function describePlace(p: SearchResult) {
    const where = [p.name, p.country ? countryName(p.country, i18n.language) : null].filter(Boolean).join(', ');
    return [where, t('search.parkCount', { count: p.park_count ?? 0 })].join(' · ');
  }

  const showPeople = (filter === 'all' || filter === 'people') && (results?.people.length ?? 0) > 0;
  const showPlaces = (filter === 'all' || filter === 'parks') && (results?.places.length ?? 0) > 0;
  const showParks = (filter === 'all' || filter === 'parks') && (results?.parks.length ?? 0) > 0;
  const showPages = (filter === 'all' || filter === 'pages') && (results?.pages.length ?? 0) > 0;
  const nothing = results !== null && !showPeople && !showPlaces && !showParks && !showPages;
  // Offered under any search that could have been for a brand or shop.
  const offerSuggest = results !== null && (filter === 'all' || filter === 'pages');

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('find.all') },
    { key: 'people', label: t('find.people') },
    { key: 'parks', label: t('find.parks') },
    { key: 'pages', label: t('find.pages') },
  ];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.top}>
        <Text variant="display" accessibilityRole="header">
          {t('find.title')}
        </Text>

        <View style={[styles.input, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <Icon name="search" color={c.text} size={20} />
          <TextInput
            accessibilityLabel={t('find.placeholder')}
            value={q}
            onChangeText={onChangeQuery}
            placeholder={t('find.placeholder')}
            placeholderTextColor={c.textMuted}
            selectionColor={c.accent}
            cursorColor={c.text}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={remember}
            style={[styles.inputText, { color: c.text }]}
          />
          {q ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('search.clear')}
              onPress={() => onChangeQuery('')}
              style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
            >
              <Icon name="close" color={c.text} size={18} />
            </Pressable>
          ) : null}
        </View>

        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('find.show')}
          style={[styles.segments, { borderColor: c.border }]}
        >
          {filters.map(({ key, label }) => {
            const on = filter === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={label}
                onPress={() => setFilter(key)}
                hitSlop={{ top: 6, bottom: 6 }}
                style={({ pressed }) => [
                  styles.segment,
                  { backgroundColor: on ? c.text : c.surfaceRaised },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  variant="bodySm"
                  style={{ color: on ? c.surface : c.text, fontFamily: fontFamily.sansSemiBold }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {results === null && !searching ? (
          <SearchIdle
            filter={filter}
            here={here}
            locationState={locationState}
            onTurnOnLocation={() => void locate(true)}
            recent={recent.recent}
            onPickRecent={searchAgain}
            onRemoveRecent={recent.remove}
            onClearRecent={recent.clear}
          />
        ) : searching && results === null ? (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} />
        ) : nothing && results?.failed ? (
          <EmptyState
            icon="cloudOff"
            title={t('empty.searchErrorTitle')}
            body={t('find.error')}
            action={{ label: t('common.retry'), onPress: () => void run(q.trim()) }}
          />
        ) : nothing ? (
          <EmptyState
            align="start"
            title={t('empty.noResultsTitle')}
            body={
              <View style={styles.noResults} accessibilityLiveRegion="polite">
                <Text variant="body">{t('empty.noResultsBody', { q: q.trim() })}</Text>
                <Text variant="bodySm" color="textSecondary">
                  {t('empty.noResultsHow')}
                </Text>
              </View>
            }
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/city-search')}
              style={({ pressed }) => [styles.cityLink, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
            >
              <Icon name="map" color={c.text} size={20} />
              <Text variant="body" style={styles.cityLinkText}>
                {t('empty.findByCity')}
              </Text>
              <Icon name="chevron" color={c.textSecondary} size={16} />
            </Pressable>
          </EmptyState>
        ) : (
          <>
            {showPeople ? (
              <View style={styles.list}>
                <Text variant="label" color="textSecondary" accessibilityRole="header">
                  {t('find.people')}
                </Text>
                {results?.people.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    line={describePerson(p)}
                    onPress={() => {
                      remember();
                      router.push({ pathname: '/profile/[username]', params: { username: p.username } });
                    }}
                  />
                ))}
              </View>
            ) : null}
            {showPlaces ? (
              <View style={styles.list}>
                <Text variant="label" color="textSecondary" accessibilityRole="header">
                  {t('find.places')}
                </Text>
                {results?.places.map((p) => (
                  <PlaceRow
                    key={p.id}
                    line={describePlace(p)}
                    region={p.detail}
                    onPress={() => {
                      remember();
                      showMetroOnMap(p.id);
                    }}
                  />
                ))}
              </View>
            ) : null}
            {showParks ? (
              <View style={styles.list}>
                <Text variant="label" color="textSecondary" accessibilityRole="header">
                  {t('find.parks')}
                </Text>
                {results?.parks.map((p) => (
                  <ParkRow
                    key={p.id}
                    name={p.name}
                    line={describePark(p)}
                    status={p.status}
                    saved={saved.has(p.id)}
                    onPress={() => {
                      remember();
                      router.push({ pathname: '/park/[slug]', params: { slug: p.slug } });
                    }}
                    onSave={() => void toggle(p.id)}
                  />
                ))}
              </View>
            ) : null}
            {showPages ? (
              <View style={styles.list}>
                <Text variant="label" color="textSecondary" accessibilityRole="header">
                  {t('find.pagesHeading')}
                </Text>
                {results?.pages.map((p) => (
                  <PageRow
                    key={p.id}
                    page={p}
                    onPress={() => {
                      remember();
                      router.push({ pathname: '/page/[handle]', params: { handle: p.handle } });
                    }}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
        {offerSuggest ? <SuggestPageBox /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** How many rows each idle section shows (All is a sampler; a filter shows more). */
const SAMPLE = 3;
const MORE = 5;

/**
 * Search with nothing typed (Empty states · Search, Nov 5): real content
 * instead of a hint. All: Recent, Parks near you, Skaters at your parks.
 * People: skaters at your parks, then your discipline in your home city.
 * Parks: near you, then Want to skate. Pages: pages you follow, plus the
 * suggest box. With location off, a card offers to turn it on (the screen's
 * one pink button) and parks come from your home city, without distances.
 */
function SearchIdle({
  filter,
  here,
  locationState,
  onTurnOnLocation,
  recent,
  onPickRecent,
  onRemoveRecent,
  onClearRecent,
}: {
  filter: Filter;
  here: Point | null;
  locationState: 'checking' | 'on' | 'off';
  onTurnOnLocation: () => void;
  recent: string[];
  onPickRecent: (q: string) => void;
  onRemoveRecent: (q: string) => void;
  onClearRecent: () => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const metroId = profile?.home_metro_area_id ?? null;
  const metro = useMetro(metroId);
  const city = metro.data?.name ?? '';
  const { saved, toggle } = useSavedParks(userId);
  const savedIds = useMemo(() => [...saved], [saved]);
  const parkLine = useParkLine();
  const goPark = (slug: string) => router.push({ pathname: '/park/[slug]', params: { slug } });

  const wantsParks = filter === 'all' || filter === 'parks';
  const wantsPeople = filter === 'all' || filter === 'people';
  const off = locationState === 'off';

  // Parks near you, by distance, once location is on.
  const nearMax = filter === 'parks' ? MORE : SAMPLE;
  const near = useQuery({
    queryKey: here ? keys.parksNear(here.latitude, here.longitude, nearMax) : ['parks', 'near', 'none'],
    queryFn: () => parksNear(here!.latitude, here!.longitude, nearMax),
    enabled: wantsParks && Boolean(here),
    staleTime: fresh.parks,
  });
  // Location off: the home city's parks instead, without distances.
  const cityParks = useParksInMetro(wantsParks && off ? metroId : null);
  const savedParks = useParksByIds(filter === 'parks' ? savedIds : []);

  const atParks = useSkatersAtYourParks(userId, profile?.home_park_id, savedIds, filter === 'people' ? MORE : SAMPLE);
  // Your first discipline, for People's second section; page joiners may have none.
  const discipline = profile?.disciplines[0] ?? null;
  const inCity = useSkatersInMetro(userId, wantsPeople ? metroId : null, filter === 'people' ? discipline : null, filter === 'people' ? MORE : SAMPLE);

  const followedPages = useQuery({
    queryKey: keys.pageSearch('', true),
    queryFn: () => searchPages('', true, 50),
    enabled: filter === 'pages',
    staleTime: fresh.search,
  });

  const distance = (p: ParkPin) =>
    here ? formatDistance(p.distance_m ?? distanceMeters(here, p), usesMetric(), i18n.language) : null;
  const parkRow = (p: ParkPin, withDistance: boolean) => (
    <ParkRow
      key={p.id}
      name={p.display_name}
      line={[parkLine(p, p.city), withDistance ? distance(p) : null].filter(Boolean).join(' · ')}
      status={p.status}
      saved={saved.has(p.id)}
      onPress={() => goPark(p.slug)}
      onSave={() => void toggle(p.id)}
    />
  );

  const seeMap = {
    label: t('empty.seeMap'),
    onPress: () => router.navigate(off && metroId ? { pathname: '/', params: { metro: metroId } } : '/'),
  };
  const sections: ReactNode[] = [];

  if (filter === 'all' && recent.length) {
    sections.push(
      <View key="recent" style={styles.list}>
        <SectionHead title={t('empty.recent')} link={{ label: t('empty.clear'), onPress: onClearRecent }} />
        <RecentSearchRows items={recent} onPick={onPickRecent} onRemove={onRemoveRecent} />
      </View>,
    );
  }

  if (wantsParks) {
    if (off) {
      sections.push(
        <View key="location" style={[styles.locationCard, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <View style={styles.locationText}>
            <Icon name="pinOff" color={c.text} size={24} />
            <View style={styles.flex}>
              <Text variant="headline">{t('empty.parksNearYou')}</Text>
              <Text variant="bodySm" color="textSecondary">
                {t('empty.locationBody')}
              </Text>
            </View>
          </View>
          <Button
            label={t('empty.turnOnLocation')}
            onPress={onTurnOnLocation}
            palette={{ fill: c.accent, text: c.onAccent, border: c.onAccent }}
            style={styles.locationButton}
          />
        </View>,
      );
      const list = (cityParks.data ?? []).slice(0, nearMax);
      if (list.length) {
        sections.push(
          <View key="city-parks" style={styles.list}>
            <SectionHead title={t('empty.parksIn', { city })} link={seeMap} />
            <Text variant="caption" color="textSecondary">
              {t('empty.parksInNote')}
            </Text>
            {list.map((p) => parkRow(p, false))}
          </View>,
        );
      }
    } else if (near.data?.length) {
      sections.push(
        <View key="near" style={styles.list}>
          <SectionHead title={filter === 'parks' ? t('empty.nearYou') : t('empty.parksNearYou')} link={seeMap} />
          {near.data.map((p) => parkRow(p, true))}
        </View>,
      );
    }
  }

  if (filter === 'parks') {
    const list = (savedParks.data ?? []).filter((p) => saved.has(p.id));
    if (list.length) {
      sections.push(
        <View key="saved" style={styles.list}>
          <SectionHead title={t('empty.wantToSkate')} />
          <Text variant="caption" color="textSecondary">
            {t('empty.wantToSkateNote')}
          </Text>
          {list.map((p) => parkRow(p, true))}
        </View>,
      );
    }
  }

  if (wantsPeople) {
    const atList = atParks.people ?? [];
    const cityList = inCity.people ?? [];
    if (atList.length) {
      sections.push(
        <View key="at-parks" style={styles.list}>
          <SectionHead title={t('empty.skatersAtYourParks')} />
          {filter === 'people' ? (
            <Text variant="caption" color="textSecondary">
              {t('empty.skatersAtYourParksNote')}
            </Text>
          ) : null}
          {atList.map((p) => (
            <SkaterRow key={p.id} person={p} />
          ))}
        </View>,
      );
    }
    // People always shows the home city; All only when your parks have nobody yet.
    const cityShown = filter === 'people' ? cityList.filter((p) => !atList.some((a) => a.id === p.id)) : atList.length ? [] : cityList;
    if (cityShown.length && city) {
      sections.push(
        <View key="in-city" style={styles.list}>
          <SectionHead
            title={
              filter === 'people' && discipline
                ? t('empty.disciplineIn', { discipline: t(`disciplines.${discipline}`), city })
                : t('empty.skatersIn', { city })
            }
          />
          {cityShown.map((p) => (
            <SkaterRow key={p.id} person={p} />
          ))}
        </View>,
      );
    }
  }

  if (filter === 'pages') {
    const pages = followedPages.data ?? [];
    if (pages.length) {
      sections.push(
        <View key="pages" style={styles.list}>
          <SectionHead title={t('empty.pagesYouFollow')} />
          {pages.map((p) => (
            <PageRow
              key={p.id}
              page={p}
              onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: p.handle } })}
            />
          ))}
        </View>,
      );
    }
    sections.push(<SuggestPageBox key="suggest" />);
  }

  // Nothing to show yet (a new city, or still loading): the one-line hint.
  if (sections.length === 0 || (filter === 'pages' && sections.length === 1)) {
    sections.unshift(
      <Text key="hint" variant="body" color="textSecondary">
        {t('find.hint')}
      </Text>,
    );
  }

  return <>{sections}</>;
}

/**
 * A city in the results: "Copenhagen, Denmark · 12 parks", with the region
 * (Capital Region) under it when there is one. Opens the Map tab on that city,
 * the same as picking it in the map's own search.
 */
function PlaceRow({ line, region, onPress }: { line: string; region: string | null; onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[line, region].filter(Boolean).join(', ')}
      accessibilityHint={t('find.placeHint')}
      onPress={onPress}
      style={({ pressed }) => [styles.place, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
    >
      <Icon name="map" color={c.text} size={20} />
      <View style={styles.personMain}>
        <Text variant="headline" numberOfLines={1}>
          {line}
        </Text>
        {region ? (
          <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
            {region}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron" color={c.textSecondary} size={18} />
    </Pressable>
  );
}

/** A person in the results: initials, username (lock if private), one line, and "Following". */
function PersonRow({ person, line, onPress }: { person: PersonResult; line: string; onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const status =
    person.follow_status === 'accepted'
      ? t('find.following')
      : person.follow_status === 'pending'
        ? t('find.requested')
        : null;
  const label = [
    person.username,
    person.is_private ? t('find.privateAccount') : null,
    line || null,
    status,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.person, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
    >
      <View style={[styles.initials, { backgroundColor: c.borderSubtle }]}>
        <Text variant="headline" style={styles.initialsText}>
          {person.username.slice(0, 2).toUpperCase()}
        </Text>
      </View>
      <View style={styles.personMain}>
        <View style={styles.nameRow}>
          <Text variant="headline" numberOfLines={1} style={styles.shrink}>
            {person.username}
          </Text>
          {person.is_private ? <Icon name="lock" color={c.text} size={15} /> : null}
        </View>
        {line ? (
          <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
            {line}
          </Text>
        ) : null}
      </View>
      {status ? (
        <Text variant="label" color="textSecondary">
          {status}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pressed: { opacity: 0.75 },
  top: { paddingHorizontal: space[4], paddingTop: space[4], gap: space[3] },
  input: {
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingLeft: space[3],
  },
  inputText: { flex: 1, minWidth: 0, fontFamily: fontFamily.sans, fontSize: 16 },
  clear: { width: size.tapMin, height: size.tapMin - stroke.rule * 2, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: stroke.rule },
  segment: { height: 36, minWidth: size.tapMin, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space[4], gap: space[6] },
  list: { gap: 6 },
  person: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: 10,
  },
  place: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: 10,
  },
  initials: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontSize: 15 },
  personMain: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
  flex: { flex: 1 },
  noResults: { gap: space[2] },
  cityLink: { minHeight: size.tapMin, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], marginTop: space[2] },
  cityLinkText: { flex: 1, fontFamily: fontFamily.sansSemiBold },
  locationCard: { borderWidth: stroke.rule, padding: 14, gap: space[3] },
  locationText: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  locationButton: { minHeight: size.tapMin },
});
