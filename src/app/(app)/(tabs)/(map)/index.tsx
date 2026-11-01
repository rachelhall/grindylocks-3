import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, openDirections, SaveButton, StatusChip, useParkLine } from '@/components/parks';
import { Button, Icon } from '@/components/ui';
import { usesMetric } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { openState } from '@/lib/hours';
import {
  type Bounds,
  distanceMeters,
  fetchPark,
  formatDistance,
  type ParkDetail,
  type ParkPin,
  parksInBounds,
  parksInMetro,
  parksNear,
  useSavedParks,
} from '@/lib/parks';
import { fontFamily, size, space, stroke, Text, useColors, useColorSchemeName } from '@/theme';

type LatLng = { latitude: number; longitude: number };

/** Roughly a neighbourhood: enough to see a few nearby parks. */
const NEAR_DELTA = 0.12;

function toBounds(r: Region): Bounds {
  return {
    north: r.latitude + r.latitudeDelta / 2,
    south: r.latitude - r.latitudeDelta / 2,
    east: r.longitude + r.longitudeDelta / 2,
    west: r.longitude - r.longitudeDelta / 2,
  };
}

/**
 * The map: parks around you (or around your home city if location is off),
 * a search bar for cities and parks, and a preview card for the picked park.
 * Opening with ?metro=<id> (from city search) fits the map to that city.
 */
export default function MapScreen() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const scheme = useColorSchemeName();
  const insets = useSafeAreaInsets();
  const { session, profile } = useAuth();
  const { metro } = useLocalSearchParams<{ metro?: string }>();
  const mapRef = useRef<MapView>(null);
  const { saved, toggle } = useSavedParks(session?.user.id);
  const describe = useParkLine();

  const [pins, setPins] = useState<ParkPin[]>([]);
  const [selected, setSelected] = useState<ParkPin | null>(null);
  const [detail, setDetail] = useState<ParkDetail | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [locationOn, setLocationOn] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Where to start ------------------------------------------------------- */

  const fitTo = useCallback((coords: LatLng[]) => {
    if (coords.length === 0) return;
    if (coords.length === 1) {
      mapRef.current?.animateToRegion({ ...coords[0], latitudeDelta: NEAR_DELTA, longitudeDelta: NEAR_DELTA }, 400);
      return;
    }
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 140, right: 48, bottom: 260, left: 48 },
      animated: true,
    });
  }, []);

  const showHomeCity = useCallback(async () => {
    const metroId = profile?.home_metro_area_id;
    if (!metroId) return;
    const parks = await parksInMetro(metroId).catch(() => []);
    const located = parks.filter((p) => p.latitude !== null);
    fitTo(located);
    if (located[0]) setSelected((s) => s ?? located[0]);
  }, [fitTo, profile?.home_metro_area_id]);

  const locate = useCallback(
    async (ask: boolean) => {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && ask && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setLocationOn(false);
        return null;
      }
      setLocationOn(true);
      const pos =
        (await Location.getLastKnownPositionAsync().catch(() => null)) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
      if (!pos) return null;
      const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setMe(here);
      return here;
    },
    [],
  );

  // First open: a city picked in search wins; otherwise near you; otherwise
  // your home city.
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    (async () => {
      if (metro) {
        const parks = await parksInMetro(metro).catch(() => []);
        if (cancelled) return;
        const located = parks.filter((p) => p.latitude !== null);
        fitTo(located);
        setSelected(located[0] ?? null);
        void locate(false);
        return;
      }
      const here = await locate(true);
      if (cancelled) return;
      if (!here) {
        await showHomeCity();
        return;
      }
      const near = await parksNear(here.latitude, here.longitude, 5).catch(() => []);
      if (cancelled) return;
      if (near[0]) {
        setSelected(near[0]);
        // Frame you and the nearest park together.
        fitTo([here, { latitude: near[0].latitude, longitude: near[0].longitude }]);
      } else {
        mapRef.current?.animateToRegion({ ...here, latitudeDelta: NEAR_DELTA, longitudeDelta: NEAR_DELTA }, 400);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, metro, fitTo, locate, showHomeCity]);

  /* Pins for the visible area --------------------------------------------- */

  const onRegionChangeComplete = useCallback((region: Region) => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => {
      parksInBounds(toBounds(region))
        .then((parks) => {
          setPins(parks);
          setLoadError(false);
        })
        .catch(() => setLoadError(true));
    }, 250);
  }, []);

  // The card needs hours and the metro's time zone for "open now".
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetchPark(selected.slug)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function recenter() {
    const here = me ?? (await locate(true));
    if (here) {
      mapRef.current?.animateToRegion({ ...here, latitudeDelta: NEAR_DELTA, longitudeDelta: NEAR_DELTA }, 400);
    } else {
      await showHomeCity();
    }
  }

  /* Card ----------------------------------------------------------------------- */

  const metric = usesMetric();
  const cardDetail = detail && selected && detail.id === selected.id ? detail : null;
  const state = cardDetail
    ? openState(cardDetail.status, cardDetail.sessions, {
        latitude: cardDetail.latitude,
        longitude: cardDetail.longitude,
        timeZone: cardDetail.metro?.timezone ?? null,
      })
    : null;
  const distance =
    selected && me
      ? formatDistance(selected.distance_m ?? distanceMeters(me, selected), metric, i18n.language)
      : null;

  // Keep the selected pin on the map even when it's outside the last fetch.
  const shown = selected && !pins.some((p) => p.id === selected.id) ? [...pins, selected] : pins;

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: 32.75, longitude: -117.15, latitudeDelta: 0.4, longitudeDelta: 0.4 }}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation={locationOn}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        showsCompass={false}
        toolbarEnabled={false}
        pitchEnabled={false}
        userInterfaceStyle={scheme}
        mapPadding={{ top: 0, right: 0, bottom: 220, left: 0 }}
      >
        {shown.map((p) => {
          const isSelected = p.id === selected?.id;
          return (
            <Marker
              key={`${p.id}-${isSelected ? 's' : 'n'}`}
              coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              onPress={() => setSelected(p)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={isSelected ? 2 : 1}
              accessibilityLabel={isSelected ? t('map.pinSelected', { park: p.display_name }) : p.display_name}
            >
              {isSelected ? (
                <View style={[styles.pinSelected, { backgroundColor: c.mapPin, borderColor: c.mapPinOutline }]}>
                  <Icon name="pin" color={c.onAccent} size={18} />
                  <Text variant="label" style={{ color: c.onAccent, fontFamily: fontFamily.display }} numberOfLines={1}>
                    {p.display_name}
                  </Text>
                </View>
              ) : (
                <View style={[styles.pin, { backgroundColor: c.surfaceRaised, borderColor: c.mapPinOutline }]}>
                  <Icon name="pin" color={c.text} size={18} />
                </View>
              )}
            </Marker>
          );
        })}
      </MapView>

      {/* Search bar */}
      <View style={[styles.top, { top: insets.top + space[2] }]}>
        <Pressable
          accessibilityRole="search"
          accessibilityLabel={t('map.search')}
          onPress={() => router.push('/search')}
          style={({ pressed }) => [
            styles.search,
            { backgroundColor: c.surfaceRaised, borderColor: c.border },
            pressed && styles.pressed,
          ]}
        >
          <Icon name="search" color={c.text} size={20} />
          <Text variant="body" color="textSecondary">
            {t('map.search')}
          </Text>
        </Pressable>
        {loadError ? (
          <View style={[styles.notice, { backgroundColor: c.surfaceRaised, borderColor: c.statusClosed }]}>
            <Text variant="bodySm" color="statusClosed">
              {t('map.loadError')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Locate me */}
      <View style={[styles.locate, { bottom: (selected ? 228 : 24) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('map.locate')}
          onPress={recenter}
          style={({ pressed }) => [
            styles.square,
            { backgroundColor: c.surfaceRaised, borderColor: c.border },
            pressed && styles.pressed,
          ]}
        >
          <Icon name="locate" color={c.text} size={22} />
        </Pressable>
      </View>

      {/* Preview card */}
      {selected ? (
        <View style={[styles.card, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/park/[slug]', params: { slug: selected.slug } })}
            style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
          >
            <Text variant="label" color="textSecondary">
              {[distance, t(`park.type.${selected.park_type}`)].filter(Boolean).join(' · ')}
            </Text>
            <Text variant="title" numberOfLines={1}>
              {selected.display_name}
            </Text>
            <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
              {describe({ ...selected, park_type: 'skatepark' }, selected.city)}
            </Text>
            <StatusChip state={state} />
          </Pressable>
          <View style={styles.cardActions}>
            <Button
              label={t('map.viewPark')}
              onPress={() => router.push({ pathname: '/park/[slug]', params: { slug: selected.slug } })}
              style={styles.flex}
            />
            <SaveButton
              saved={saved.has(selected.id)}
              onPress={() => void toggle(selected.id)}
              parkName={selected.display_name}
              boxed
            />
            <IconButton icon="directions" label={t('map.directions')} onPress={() => openDirections(selected)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  top: { position: 'absolute', left: space[4], right: space[4], gap: space[2] },
  search: {
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
  },
  notice: { borderWidth: stroke.rule, padding: space[2] },
  locate: { position: 'absolute', right: space[4] },
  square: { width: size.tapMin, height: size.tapMin, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  pin: { width: 36, height: 36, borderWidth: stroke.rule, alignItems: 'center', justifyContent: 'center' },
  pinSelected: {
    height: 40,
    maxWidth: 200,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 6,
    paddingRight: 10,
  },
  card: {
    position: 'absolute',
    left: space[3],
    right: space[3],
    bottom: space[3],
    borderWidth: stroke.rule,
    padding: space[3],
    gap: space[3],
  },
  cardMain: { gap: space[1] },
  cardActions: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
});
