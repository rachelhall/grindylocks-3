import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';

import { EditBar } from '@/components/edit-bar';
import { useTeamErrorAlert } from '@/components/page-team';
import { SafeAreaView } from '@/components/safe-area';
import { openSupportMail } from '@/components/settings';
import { BackButton, Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { roleRank, useSetPageLocation } from '@/lib/page-team';
import { type Page, usePage, usePageViewerState } from '@/lib/pages';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

const MAX_ADDRESS = 200;
/** About a street's width each way: close enough to put the pin on a door. */
const STREET = { latitudeDelta: 0.004, longitudeDelta: 0.004 };
/** Before there's a pin or an address match: the whole world, so nothing looks placed. */
const WORLD: Region = { latitude: 20, longitude: 0, latitudeDelta: 120, longitudeDelta: 160 };

/**
 * Edit page › Address and pin (part A PR 7b, Page-Address mockup), managers
 * and the owner of a shop. The address shows on the page as written. "Find
 * this address on the map" asks the phone's own address lookup and moves the
 * map; the pin stays in the middle and the map moves under it. The city and
 * metro area stay with Rachel, since they decide Near you and the shop's
 * city admin.
 */
export default function PageAddressScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { session } = useAuth();
  const { data: page, isError, refetch } = usePage(handle);
  const viewer = usePageViewerState(session?.user.id, page?.id);
  if (!page || !viewer.data) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        {isError || viewer.isError ? (
          <View style={styles.block}>
            <Text variant="body" color="textSecondary">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} onPress={() => void refetch()} />
          </View>
        ) : (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }
  if (roleRank(viewer.data.teamRole) < 2 || page.state !== 'managed' || !page.roles.includes('shop')) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        <View style={styles.block}>
          <Text variant="body" color="textSecondary">
            {t('pageEdit.notYours')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  return <AddressForm key={page.id} page={page} />;
}

type Pin = { latitude: number; longitude: number };

function AddressForm({ page }: { page: Page }) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const alertError = useTeamErrorAlert();
  const save = useSetPageLocation(session?.user.id);
  const mapRef = useRef<MapView>(null);

  const original: Pin | null = page.latitude !== null && page.longitude !== null ? { latitude: page.latitude, longitude: page.longitude } : null;
  const [address, setAddress] = useState(page.address ?? '');
  const [pin, setPin] = useState<Pin | null>(original);
  /** Where "back to the address" goes: the last lookup, else the saved pin. */
  const [found, setFound] = useState<Pin | null>(original);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moved = (pin?.latitude ?? null) !== (original?.latitude ?? null) || (pin?.longitude ?? null) !== (original?.longitude ?? null);
  const dirty = address.trim() !== (page.address ?? '') || moved;

  const goTo = (p: Pin) => mapRef.current?.animateToRegion({ ...p, ...STREET }, 400);

  const find = async () => {
    const text = [address.trim(), page.city].filter(Boolean).join(', ');
    if (!text) return;
    setError(null);
    setFinding(true);
    try {
      // Android looks addresses up through location services, so it asks first.
      if (Platform.OS === 'android') {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) {
          setError(t('pageAddress.lookupNeedsLocation'));
          return;
        }
      }
      const [hit] = await Location.geocodeAsync(text);
      if (!hit) {
        setError(t('pageAddress.notFound'));
        return;
      }
      const p = { latitude: hit.latitude, longitude: hit.longitude };
      setFound(p);
      setPin(p);
      goTo(p);
    } catch (err) {
      Sentry.captureException(err);
      setError(t('pageAddress.notFound'));
    } finally {
      setFinding(false);
    }
  };

  // The pin is wherever the map's middle is, once the map shows somewhere real.
  const onRegionChangeComplete = (r: Region) => {
    if (r.latitudeDelta > 1) return;
    setPin({ latitude: r.latitude, longitude: r.longitude });
  };

  const submit = () => {
    setError(null);
    if (page.locationType === 'storefront' && !pin) {
      setError(t('pageAddress.pinNeeded'));
      return;
    }
    save.mutate(
      { pageId: page.id, address, pin },
      {
        onSuccess: () => router.back(),
        onError: async (err) => {
          const message = (err as { message?: string } | null)?.message ?? '';
          if (message === 'too_long') return setError(t('pageAddress.tooLong'));
          await alertError(err);
        },
      },
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <EditBar title={t('pageAddress.title')} dirty={dirty} saving={save.isPending} onSave={submit} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View style={styles.section}>
          <Text variant="label" color="textSecondary">
            {t('pageAddress.address')}
          </Text>
          <TextInput
            accessibilityLabel={t('pageAddress.address')}
            value={address}
            onChangeText={setAddress}
            maxLength={MAX_ADDRESS}
            multiline
            autoComplete="street-address"
            textContentType="fullStreetAddress"
            style={[styles.textarea, { borderColor: c.border, backgroundColor: c.surfaceRaised, color: c.text }]}
          />
          <Text variant="bodySm" color="textSecondary">
            {t('pageAddress.addressNote')}
          </Text>
          <Button
            variant="secondary"
            icon="search"
            label={t('pageAddress.find')}
            onPress={() => void find()}
            loading={finding}
            disabled={!address.trim()}
          />
        </View>

        <View style={styles.section}>
          <Text variant="label" color="textSecondary">
            {t('pageAddress.pin')}
          </Text>
          <View
            style={[styles.map, { borderColor: c.border }]}
            accessible
            accessibilityLabel={pin ? t('pageAddress.mapLabel') : t('pageAddress.mapLabelEmpty')}
          >
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              initialRegion={original ? { ...original, ...STREET } : WORLD}
              onRegionChangeComplete={onRegionChangeComplete}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              showsPointsOfInterests={false}
            />
            <View pointerEvents="none" style={styles.pinWrap}>
              <View style={[styles.pin, { borderColor: brand.paper, outlineColor: c.accent }]}>
                <Icon name="storefront" color={brand.paper} size={22} />
              </View>
              <View style={styles.pinTip} />
            </View>
            <View pointerEvents="none" style={[styles.hint, { backgroundColor: brand.ink }]}>
              <Text variant="bodySm" style={{ color: brand.paper, fontFamily: fontFamily.sansSemiBold }}>
                {pin ? t('pageAddress.moveMap') : t('pageAddress.findFirst')}
              </Text>
            </View>
            {found ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('pageAddress.backToAddress')}
                onPress={() => goTo(found)}
                style={({ pressed }) => [styles.recenter, { borderColor: c.border, backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
              >
                <Icon name="recenter" color={c.text} size={22} />
              </Pressable>
            ) : null}
          </View>
          <Text variant="bodySm" color="textSecondary">
            {t(page.locationType === 'storefront' ? 'pageAddress.pinNoteStorefront' : 'pageAddress.pinNote', { name: page.displayName })}
          </Text>
          {pin && moved ? (
            <Text variant="bodySm" color="accentText" accessibilityRole="button" onPress={() => setPin(original)} style={styles.link}>
              {original ? t('pageAddress.undoPin') : t('pageAddress.clearPin')}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text variant="label" color="textSecondary">
            {t('pageAddress.city')}
          </Text>
          <Text variant="headline">{page.city ?? t('pageAddress.noCity')}</Text>
          <Text variant="bodySm" color="textSecondary">
            {t('pageAddress.cityNote')}
            <Text
              variant="bodySm"
              color="accentText"
              accessibilityRole="link"
              onPress={() => void openSupportMail(t('pageAddress.citySubject', { name: page.displayName }))}
              style={styles.link}
            >
              {t('pageEdit.askRachel')}
            </Text>
            {t('pageEdit.askRachelAfter')}
          </Text>
        </View>

        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pressed: { opacity: 0.75 },
  top: { paddingHorizontal: space[4], paddingVertical: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3], paddingTop: space[4] },
  loading: { marginTop: space[12] },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: space[12], gap: 22 },
  section: { gap: space[2] },
  link: { fontFamily: fontFamily.sansSemiBold },
  textarea: { minHeight: 72, borderWidth: stroke.rule, paddingHorizontal: space[3], paddingVertical: 10, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' },
  map: { height: 320, borderWidth: stroke.rule, overflow: 'hidden' },
  pinWrap: { position: 'absolute', left: '50%', top: '50%', marginLeft: -20, marginTop: -50, alignItems: 'center' },
  pin: {
    width: 40,
    height: 40,
    backgroundColor: brand.ink,
    borderWidth: stroke.rule,
    outlineWidth: 3,
    outlineStyle: 'solid',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinTip: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: brand.ink },
  hint: { position: 'absolute', left: 10, top: 10, right: 10, paddingHorizontal: 10, paddingVertical: 8 },
  recenter: { position: 'absolute', right: 10, bottom: 10, width: size.tapMin, height: size.tapMin, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
});
