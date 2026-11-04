import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { PageRow, SuggestPageBox } from '@/components/pages';
import { ParkRow } from '@/components/parks';
import { Icon } from '@/components/ui';
import { usesMetric } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { type PageResult, searchPages } from '@/lib/pages';
import { type PersonResult, searchPeople } from '@/lib/people';
import {
  distanceMeters,
  formatDistance,
  parkCoords,
  type SearchResult,
  searchDirectory,
  useSavedParks,
} from '@/lib/parks';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

type Filter = 'all' | 'people' | 'parks' | 'pages';
type Point = { latitude: number; longitude: number };
type Results = {
  people: PersonResult[];
  parks: SearchResult[];
  pages: PageResult[];
  coords: Map<string, Point>;
  failed: boolean;
};

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

/**
 * Search tab (Nov 1): one box for people, parks and brand and shop pages, an
 * All / People / Parks / Pages switch, and results grouped by type. People
 * match on username; parks on display name, official name and aliases;
 * pages on handle, name and "Formerly" names, all accent-insensitive. Under
 * the results (All and Pages), "Can't find a brand or shop? Suggest it"
 * (Search-Pages mockup, v2). The map's own search bar stays for picking a
 * city to plan a trip.
 */
export default function Search() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const { saved, toggle } = useSavedParks(session?.user.id);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);
  const [here, setHere] = useState<Point | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef('');

  // Distances only when location is already allowed; Search never asks.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted) return;
      const pos = await Location.getLastKnownPositionAsync().catch(() => null);
      if (pos && !cancelled) setHere({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    const parks = directory.filter((r) => r.kind === 'park');
    // Coordinates come separately, so distances can show once location arrives.
    const coords = await parkCoords(parks.map((p) => p.id)).catch(() => new Map<string, Point>());
    if (latest.current !== query) return;
    setResults({ people, parks, pages, coords, failed });
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

  const showPeople = (filter === 'all' || filter === 'people') && (results?.people.length ?? 0) > 0;
  const showParks = (filter === 'all' || filter === 'parks') && (results?.parks.length ?? 0) > 0;
  const showPages = (filter === 'all' || filter === 'pages') && (results?.pages.length ?? 0) > 0;
  const nothing = results !== null && !showPeople && !showParks && !showPages;
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
          <Text variant="body" color="textSecondary">
            {t('find.hint')}
          </Text>
        ) : searching && results === null ? (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} />
        ) : nothing ? (
          <Text variant="body" color={results?.failed ? 'statusClosed' : 'textSecondary'} accessibilityLiveRegion="polite">
            {results?.failed ? t('find.error') : t('search.noResults', { q: q.trim() })}
          </Text>
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
                    onPress={() =>
                      router.push({ pathname: '/profile/[username]', params: { username: p.username } })
                    }
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
                    onPress={() => router.push({ pathname: '/park/[slug]', params: { slug: p.slug } })}
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
                    onPress={() => router.push({ pathname: '/page/[handle]', params: { handle: p.handle } })}
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
  initials: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontSize: 15 },
  personMain: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
});
