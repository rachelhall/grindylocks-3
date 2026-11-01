import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { FormScreen } from '@/components/screen';
import { Button, SelectRow, StepHeader, TextField, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ONBOARDING_STEPS, useOnboarding } from '@/lib/onboarding';
import { supabase } from '@/lib/supabase';
import { fontFamily, space, Text, useColors } from '@/theme';

type Metro = { id: string; name: string };
type Park = {
  id: string;
  display_name: string;
  official_name: string | null;
  aliases: string[];
  city: string;
  metro_area_id: string;
};

/** Lowercase and strip accents, so "faelled" finds "Fælledparken" and "penasquitos" finds "Peñasquitos". */
function fold(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .toLowerCase();
}

/** Every metro area and park, for the pickers. Null if either fails to load. */
async function fetchDirectory(): Promise<{ metros: Metro[]; parks: Park[] } | null> {
  const [m, p] = await Promise.all([
    supabase.from('metro_areas').select('id, name').order('name'),
    supabase
      .from('parks')
      .select('id, display_name, official_name, aliases, city, metro_area_id')
      .order('display_name'),
  ]);
  if (m.error || p.error) return null;
  return { metros: m.data, parks: p.data };
}

/**
 * Home city (required) and home park (optional). "City" here is a metro
 * area, so searching "Encinitas" or "Copenhagen" finds the metro that holds
 * it. Also asks whether to announce the new member to that city.
 */
export default function CityStep() {
  const { t } = useTranslation();
  const c = useColors();
  const { session, profile, refreshProfile } = useAuth();
  const { announce, setAnnounce, setAnnounceAsked } = useOnboarding();

  const [metros, setMetros] = useState<Metro[] | null>(null);
  const [parks, setParks] = useState<Park[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [metroId, setMetroId] = useState<string | null>(profile?.home_metro_area_id ?? null);
  const [parkId, setParkId] = useState<string | null>(profile?.home_park_id ?? null);
  const [cityQuery, setCityQuery] = useState('');
  const [parkQuery, setParkQuery] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function applyDirectory(result: Awaited<ReturnType<typeof fetchDirectory>>) {
    if (!result) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setMetros(result.metros);
    setParks(result.parks);
  }

  useEffect(() => {
    let cancelled = false;
    fetchDirectory().then((result) => {
      if (!cancelled) applyDirectory(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function retry() {
    setLoadError(false);
    applyDirectory(await fetchDirectory());
  }

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
      (m) =>
        fold(m.name).includes(q) ||
        parks.some((p) => p.metro_area_id === m.id && fold(p.city).includes(q)),
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
    if (id !== metroId) setParkId(null);
    setMetroId(id);
    setCityQuery('');
    setParkQuery('');
  }

  async function save() {
    setShowErrors(true);
    setSaveError(null);
    if (!session || !metroId) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ home_metro_area_id: metroId, home_park_id: parkId })
      .eq('id', session.user.id);
    if (error) {
      setSaving(false);
      setSaveError(t('errors.generic'));
      return;
    }
    setAnnounceAsked(true);
    await refreshProfile();
    setSaving(false);
    router.push('/regulars');
  }

  const parksLabel = (id: string) => t('onboarding.city.parks', { count: parkCount.get(id) ?? 0 });

  return (
    <FormScreen
      header={<StepHeader step={3} total={ONBOARDING_STEPS} canGoBack={router.canGoBack()} />}
      footer={
        <>
          {saveError ? (
            <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
              {saveError}
            </Text>
          ) : null}
          <Button label={t('common.continue')} onPress={save} loading={saving} disabled={!metros} />
        </>
      }
    >
      <View style={styles.intro}>
        <Text variant="display" accessibilityRole="header">
          {t('onboarding.city.title')}
        </Text>
        <Text variant="body" color="textSecondary">
          {t('onboarding.city.body')}
        </Text>
      </View>

      {loadError ? (
        <View style={styles.group}>
          <Text variant="body" color="statusClosed">
            {t('errors.network')}
          </Text>
          <Button
            label={t('common.retry')}
            variant="secondary"
            onPress={retry}
          />
        </View>
      ) : !metros ? (
        <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} />
      ) : (
        <>
          {/* Home city */}
          {metro ? (
            <View style={styles.group}>
              <Text variant="bodySm" style={styles.label}>
                {t('onboarding.city.cityLabel')}
              </Text>
              <SelectRow title={metro.name} detail={parksLabel(metro.id)} selected onPress={() => setMetroId(null)} />
              <Button variant="tertiary" label={t('onboarding.city.change')} onPress={() => setMetroId(null)} style={styles.change} />
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

          {/* Home park (optional), once a city is picked */}
          {metro ? (
            park ? (
              <View style={styles.group}>
                <Text variant="bodySm" style={styles.label}>
                  {t('onboarding.city.parkLabel')}
                  <Text variant="bodySm" color="textSecondary">{` ${t('onboarding.city.optional')}`}</Text>
                </Text>
                <SelectRow title={park.display_name} detail={park.city} selected onPress={() => setParkId(null)} />
                <Button variant="tertiary" label={t('onboarding.city.removePark')} onPress={() => setParkId(null)} style={styles.change} />
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
                        setParkId(p.id);
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

          {/* "Someone new" announcement, on by default */}
          {metro ? (
            <View style={[styles.announce, { backgroundColor: c.text }]}>
              <View style={styles.announceText}>
                <Text variant="headline" color="surface">
                  {t('onboarding.city.announceTitle', { city: metro.name })}
                </Text>
                <Text variant="bodySm" style={{ color: c.borderSubtle }}>
                  {t('onboarding.city.announceBody', { city: metro.name })}
                </Text>
              </View>
              <Toggle
                value={announce}
                onChange={setAnnounce}
                label={t('onboarding.city.announceTitle', { city: metro.name })}
                fg={c.surface}
              />
            </View>
          ) : null}
        </>
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space[3] },
  group: { gap: space[2] },
  label: { fontFamily: fontFamily.sansSemiBold },
  list: { gap: space[2] },
  change: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  announce: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], padding: space[4] },
  announceText: { flex: 1, gap: space[1] },
});
