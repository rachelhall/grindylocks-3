import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SaveButton, StatusChip, useParkLine } from '@/components/parks';
import { BackButton, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { type ParkPin, useDirectorySearch, useMetro, useParksInMetro, useSavedParks } from '@/lib/parks';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/** "Denmark" for "DK", in the reader's language; falls back to the code. */
function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * City search, per the City search mockup. Typing finds cities (metro areas,
 * including the towns inside them) and parks by display name, official name
 * or alias. Picking a city lists its parks, with a toggle to see them on the
 * map instead.
 */
export default function Search() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const { saved, toggle } = useSavedParks(session?.user.id);
  const describe = useParkLine();

  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [metroId, setMetroId] = useState<string | null>(null);

  // Searches 250 ms after typing stops. Results are cached by query text, so
  // backspacing to an earlier query shows its results at once, and the last
  // results stay up while the next ones load.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const query = q.trim();
  const search = useDirectorySearch(debounced);
  const results = query.length < 2 ? null : (search.data ?? (search.isError ? [] : null));
  const searching = query.length >= 2 && (query !== debounced || search.isFetching);

  // A picked city shows once both its name and its parks are in.
  const metroQuery = useMetro(metroId);
  const metroParksQuery = useParksInMetro(metroId);
  const metro = metroId && metroQuery.data && metroParksQuery.data ? metroQuery.data : null;
  const metroParks: ParkPin[] = metroParksQuery.data ?? [];

  function onChangeQuery(value: string) {
    setQ(value);
    setMetroId(null);
  }

  function openMetro(id: string) {
    setMetroId(id);
  }

  function openPark(slug: string) {
    router.push({ pathname: '/park/[slug]', params: { slug } });
  }

  const cities = results?.filter((r) => r.kind === 'metro') ?? [];
  const parks = results?.filter((r) => r.kind === 'park') ?? [];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton onPress={() => (metroId ? setMetroId(null) : router.back())} />
        <View style={[styles.input, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <Icon name="search" color={c.text} size={20} />
          <TextInput
            accessibilityLabel={t('map.search')}
            value={q}
            onChangeText={onChangeQuery}
            placeholder={t('map.search')}
            placeholderTextColor={c.textMuted}
            selectionColor={c.accent}
            cursorColor={c.text}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.inputText, { color: c.text }]}
          />
          {q ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('search.clear')}
              onPress={() => onChangeQuery('')}
              hitSlop={8}
              style={styles.clear}
            >
              <Icon name="close" color={c.text} size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {metro ? (
          <>
            <View style={styles.metroHead}>
              <Text variant="label" color="textSecondary">
                {[metro.region, countryName(metro.country, i18n.language)].filter(Boolean).join(' · ')}
              </Text>
              <Text variant="display">{metro.name}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text variant="bodySm" color="textSecondary" style={styles.flex}>
                {[
                  t('search.parkCount', { count: metroParks.length }),
                  metroParks.some((p) => p.setting === 'indoor')
                    ? t('search.indoorCount', { count: metroParks.filter((p) => p.setting === 'indoor').length })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={t('search.view')}
                style={[styles.toggle, { borderColor: c.border }]}
              >
                <View
                  accessibilityRole="radio"
                  accessibilityState={{ selected: true }}
                  style={[styles.toggleItem, { backgroundColor: c.text }]}
                >
                  <Icon name="list" color={c.surface} size={16} />
                  <Text variant="bodySm" style={{ color: c.surface, fontFamily: fontFamily.sansSemiBold }}>
                    {t('search.list')}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: false }}
                  onPress={() => router.navigate({ pathname: '/', params: { metro: metro.id } })}
                  style={({ pressed }) => [
                    styles.toggleItem,
                    { backgroundColor: c.surfaceRaised },
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon name="map" color={c.text} size={16} />
                  <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
                    {t('search.map')}
                  </Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.list}>
              {metroParks.map((p) => (
                <ParkRow
                  key={p.id}
                  name={p.display_name}
                  line={describe(p, p.city !== metro.name ? p.city : null)}
                  status={p.status}
                  saved={saved.has(p.id)}
                  onPress={() => openPark(p.slug)}
                  onSave={() => void toggle(p.id)}
                />
              ))}
            </View>
          </>
        ) : results === null ? (
          <Text variant="body" color="textSecondary">
            {t('search.hint')}
          </Text>
        ) : searching && results.length === 0 ? (
          <ActivityIndicator color={c.text} />
        ) : results.length === 0 ? (
          <Text variant="body" color="textSecondary">
            {t('search.noResults', { q: q.trim() })}
          </Text>
        ) : (
          <>
            {cities.length > 0 ? (
              <View style={styles.list}>
                <Text variant="label" color="textSecondary">
                  {t('search.cities')}
                </Text>
                {cities.map((m) => (
                  <Pressable
                    key={m.id}
                    accessibilityRole="button"
                    onPress={() => openMetro(m.id)}
                    style={({ pressed }) => [styles.row, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
                  >
                    <View style={styles.flex}>
                      <Text variant="headline">{m.name}</Text>
                      <Text variant="bodySm" color="textSecondary">
                        {[m.detail, m.country ? countryName(m.country, i18n.language) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    <Text variant="label" color="textSecondary">
                      {t('search.parkCount', { count: m.park_count })}
                    </Text>
                    <Icon name="chevron" color={c.textSecondary} size={18} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {parks.length > 0 ? (
              <View style={styles.list}>
                <Text variant="label" color="textSecondary">
                  {t('search.parks')}
                </Text>
                {parks.map((p) => (
                  <ParkRow
                    key={p.id}
                    name={p.name}
                    line={[
                      p.detail,
                      p.matched_alias ? t('search.alsoKnownAs', { name: p.matched_alias }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    status={p.status}
                    saved={saved.has(p.id)}
                    onPress={() => openPark(p.slug)}
                    onSave={() => void toggle(p.id)}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A park in a list: name, one line, a status chip unless open, and the bookmark. */
function ParkRow({
  name,
  line,
  status,
  saved,
  onPress,
  onSave,
}: {
  name: string;
  line: string;
  status: ParkPin['status'];
  saved: boolean;
  onPress: () => void;
  onSave: () => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.parkRow, { backgroundColor: c.surfaceRaised }]}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.parkMain, pressed && styles.pressed]}
      >
        <Text variant="headline">{name}</Text>
        {line ? (
          <Text variant="bodySm" color="textSecondary">
            {line}
          </Text>
        ) : null}
        {status !== 'open' ? <StatusChip state={{ kind: 'status', status }} /> : null}
      </Pressable>
      <SaveButton saved={saved} onPress={onSave} parkName={name} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4], paddingTop: space[2] },
  input: {
    flex: 1,
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingLeft: space[3],
    paddingRight: space[1],
  },
  inputText: { flex: 1, minWidth: 0, fontFamily: fontFamily.sans, fontSize: 16 },
  clear: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space[4], gap: space[6] },
  metroHead: { gap: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  toggle: { flexDirection: 'row', borderWidth: stroke.rule },
  toggleItem: { height: 36, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  list: { gap: 6 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2] },
  parkRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[3], paddingRight: space[1], paddingVertical: space[2] },
  parkMain: { flex: 1, gap: 3, minWidth: 0 },
});
