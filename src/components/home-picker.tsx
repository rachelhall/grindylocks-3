import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, SelectRow, TextField, Toggle } from '@/components/ui';
import { fold, useDirectory } from '@/lib/parks';
import { fontFamily, space, Text, useColors } from '@/theme';

/**
 * Home city (required) and home park (optional) pickers, used by onboarding
 * and Edit profile. "City" here is a metro area, so searching "Encinitas" or
 * "Copenhagen" finds the metro that holds it. Picking a different city
 * clears the park.
 */
export function HomePicker({
  metroId,
  parkId,
  onChange,
  showErrors,
}: {
  metroId: string | null;
  parkId: string | null;
  onChange: (next: { metroId: string | null; parkId: string | null }) => void;
  /** Shows "Pick your home city" when none is picked. */
  showErrors?: boolean;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const directory = useDirectory();
  const metros = directory.data?.metros ?? null;
  const parks = useMemo(() => directory.data?.parks ?? [], [directory.data]);
  const loadError = directory.isError && !directory.data;
  const [cityQuery, setCityQuery] = useState('');
  const [parkQuery, setParkQuery] = useState('');

  const parkCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of parks) counts.set(p.metro_area_id, (counts.get(p.metro_area_id) ?? 0) + 1);
    return counts;
  }, [parks]);

  const metro = metros?.find((m) => m.id === metroId) ?? null;
  const park = parks.find((p) => p.id === parkId) ?? null;

  const metroMatches = useMemo(() => {
    if (!metros) return [];
    const q = fold(cityQuery.trim());
    if (!q) return metros;
    return metros.filter(
      (m) => fold(m.name).includes(q) || parks.some((p) => p.metro_area_id === m.id && fold(p.city).includes(q)),
    );
  }, [metros, parks, cityQuery]);

  const parkMatches = useMemo(() => {
    const q = fold(parkQuery.trim());
    if (!metroId || !q) return [];
    return parks
      .filter((p) => p.metro_area_id === metroId)
      .filter((p) =>
        [p.display_name, p.official_name ?? '', p.city, ...p.aliases].some((name) => fold(name).includes(q)),
      )
      .slice(0, 8);
  }, [parks, metroId, parkQuery]);

  function pickMetro(id: string) {
    onChange({ metroId: id, parkId: id === metroId ? parkId : null });
    setCityQuery('');
    setParkQuery('');
  }

  const clearMetro = () => onChange({ metroId: null, parkId });
  const setPark = (id: string | null) => onChange({ metroId, parkId: id });
  const parksLabel = (id: string) => t('onboarding.city.parks', { count: parkCount.get(id) ?? 0 });

  if (loadError) {
    return (
      <View style={styles.group}>
        <Text variant="body" color="statusClosed">
          {t('errors.network')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={() => void directory.refetch()} />
      </View>
    );
  }
  if (!metros) return <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} />;

  return (
    <>
      {metro ? (
        <View style={styles.group}>
          <Text variant="bodySm" style={styles.label}>
            {t('onboarding.city.cityLabel')}
          </Text>
          <SelectRow title={metro.name} detail={parksLabel(metro.id)} selected onPress={clearMetro} />
          <Button variant="tertiary" label={t('onboarding.city.change')} onPress={clearMetro} style={styles.change} />
        </View>
      ) : (
        <View style={styles.group}>
          <TextField
            label={t('onboarding.city.cityLabel')}
            icon="search"
            value={cityQuery}
            onChangeText={setCityQuery}
            placeholder={t('onboarding.city.searchCity')}
            autoCorrect={false}
            error={showErrors ? t('onboarding.city.pickCity') : null}
          />
          <View style={styles.list} accessibilityRole="radiogroup">
            {metroMatches.map((m) => (
              <SelectRow key={m.id} title={m.name} detail={parksLabel(m.id)} selected={false} onPress={() => pickMetro(m.id)} />
            ))}
            {metroMatches.length === 0 ? (
              <Text variant="bodySm" color="textSecondary">
                {t('onboarding.city.noCities')}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {metro ? (
        park ? (
          <View style={styles.group}>
            <Text variant="bodySm" style={styles.label}>
              {t('onboarding.city.parkLabel')}
              <Text variant="bodySm" color="textSecondary">{` ${t('onboarding.city.optional')}`}</Text>
            </Text>
            <SelectRow title={park.display_name} detail={park.city} selected onPress={() => setPark(null)} />
            <Button
              variant="tertiary"
              label={t('onboarding.city.removePark')}
              onPress={() => setPark(null)}
              style={styles.change}
            />
          </View>
        ) : (
          <View style={styles.group}>
            <TextField
              label={t('onboarding.city.parkLabel')}
              labelNote={t('onboarding.city.optional')}
              icon="search"
              value={parkQuery}
              onChangeText={setParkQuery}
              placeholder={t('onboarding.city.searchPark', { city: metro.name })}
              autoCorrect={false}
            />
            <View style={styles.list} accessibilityRole="radiogroup">
              {parkMatches.map((p) => (
                <SelectRow
                  key={p.id}
                  title={p.display_name}
                  detail={p.city}
                  selected={false}
                  onPress={() => {
                    setPark(p.id);
                    setParkQuery('');
                  }}
                />
              ))}
              {parkQuery.trim() && parkMatches.length === 0 ? (
                <Text variant="bodySm" color="textSecondary">
                  {t('onboarding.city.noParks')}
                </Text>
              ) : null}
            </View>
          </View>
        )
      ) : null}
    </>
  );
}

/** The ink "Say hi to {city}" card with its switch, on by default. */
export function AnnounceCard({
  city,
  value,
  onChange,
}: {
  city: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.announce, { backgroundColor: c.text }]}>
      <View style={styles.announceText}>
        <Text variant="headline" color="surface">
          {t('onboarding.city.announceTitle', { city })}
        </Text>
        <Text variant="bodySm" style={{ color: c.borderSubtle }}>
          {t('onboarding.city.announceBody', { city })}
        </Text>
      </View>
      <Toggle value={value} onChange={onChange} label={t('onboarding.city.announceTitle', { city })} fg={c.surface} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[2] },
  label: { fontFamily: fontFamily.sansSemiBold },
  list: { gap: space[2] },
  change: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  announce: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], padding: space[4] },
  announceText: { flex: 1, gap: space[1] },
});
