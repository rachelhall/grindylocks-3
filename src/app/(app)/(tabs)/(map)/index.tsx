import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeTag, FilterButton, FilterSheet } from '@/components/map-filters';
import { IconButton, openDirections, SaveButton, StatusChip, useParkLine } from '@/components/parks';
import { Button, Icon } from '@/components/ui';
import { usesMetric } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { openState } from '@/lib/hours';
import {
  type Edge,
  edgePoint,
  type Frame,
  isOnScreen,
  lngSpan,
  overlaps,
  type Point,
  project,
  tagPosition,
} from '@/lib/map-edge';
import { type MapFilters, matchesFilters, needsFacets, NO_FILTERS, useParkFacets } from '@/lib/map-filters';
import {
  type Bounds,
  busiestMetroId,
  distanceMeters,
  fetchParksInMetroCached,
  fetchParksNearCached,
  formatDistance,
  type ParkPin,
  parksNear,
  usePark,
  useMetro,
  useParksInBounds,
  useParksInMetro,
  useSavedParks,
} from '@/lib/parks';
import { fresh, keys } from '@/lib/query';
import { fontFamily, size, space, stroke, Text, useColors, useColorSchemeName } from '@/theme';

type LatLng = { latitude: number; longitude: number };

/** Roughly a neighbourhood: enough to see a few nearby parks. */
const NEAR_DELTA = 0.12;

/** Edge markers: how many off-screen parks to look through, and how many to show. */
const EDGE_CANDIDATES = 40;
const EDGE_MAX = 2;
/** Edge markers only for parks this close to the middle of the map (the same line as "near you"). */
const EDGE_MAX_M = 100_000;
/** A tag's size before it has measured itself. */
const EDGE_GUESS = { width: 170, height: 44 };

/** The locate button's distance from the bottom: on its own, and above the preview card. */
const LOCATE_BOTTOM = 24;
const LOCATE_ABOVE_CARD = 228;

/** Beyond this, the nearest park isn't "near you", and the map says so. */
const FAR_M = 100_000;

/** You, framed about 100 km out each way, so an empty map reads as "nothing nearby". */
function farRegion(here: LatLng): Region {
  const latitudeDelta = (FAR_M * 2) / 111_000;
  const shrink = Math.max(Math.cos((here.latitude * Math.PI) / 180), 0.2);
  return { ...here, latitudeDelta, longitudeDelta: latitudeDelta / shrink };
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

  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const [filters, setFilters] = useState<MapFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tagSizes, setTagSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [selected, setSelected] = useState<ParkPin | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [locationOn, setLocationOn] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  /** The closest park, when it's more than FAR_M away: shows the "no parks near you" card. */
  const [far, setFar] = useState<ParkPin | null>(null);
  const [farCardHeight, setFarCardHeight] = useState(180);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* What's on screen -------------------------------------------------------- */

  // The visible area comes from the map itself, after every move. The region
  // in onRegionChangeComplete can lag behind moves the app makes (the
  // locate button, Go to closest), which put edge markers in the wrong place.
  const syncView = useCallback(async () => {
    const b = await mapRef.current?.getMapBoundaries().catch(() => null);
    if (!b) return;
    setBounds({
      north: b.northEast.latitude,
      south: b.southWest.latitude,
      east: b.northEast.longitude,
      west: b.southWest.longitude,
    });
  }, []);

  // Settles 250 ms after the map stops moving (or just after a move the app makes).
  const scheduleSync = useCallback(
    (delay = 250) => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
      fetchTimer.current = setTimeout(() => void syncView(), delay);
    },
    [syncView],
  );

  const animateTo = useCallback(
    (r: Region) => {
      mapRef.current?.animateToRegion(r, 400);
      scheduleSync(550);
    },
    [scheduleSync],
  );

  /* Where to start ------------------------------------------------------- */

  const fitTo = useCallback(
    (coords: LatLng[]) => {
      if (coords.length === 0) return;
      if (coords.length === 1) {
        animateTo({ ...coords[0], latitudeDelta: NEAR_DELTA, longitudeDelta: NEAR_DELTA });
        return;
      }
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 140, right: 48, bottom: 260, left: 48 },
        animated: true,
      });
      scheduleSync(550);
    },
    [animateTo, scheduleSync],
  );

  // Your home city, or the metro area with the most parks if you haven't set one.
  const showHomeCity = useCallback(async () => {
    const metroId = profile?.home_metro_area_id ?? (await busiestMetroId().catch(() => null));
    if (!metroId) return;
    const parks = await fetchParksInMetroCached(metroId).catch(() => []);
    const located = parks.filter((p) => p.latitude !== null);
    fitTo(located);
    if (located[0]) setSelected((s) => s ?? located[0]);
  }, [fitTo, profile?.home_metro_area_id]);

  const locate = useCallback(async (ask: boolean) => {
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
  }, []);

  // First open: a city picked in search wins; otherwise near you; otherwise
  // your home city.
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    (async () => {
      if (metro) {
        const parks = await fetchParksInMetroCached(metro).catch(() => []);
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
      const near = await fetchParksNearCached(here.latitude, here.longitude, 5).catch(() => []);
      if (cancelled) return;
      const closest = near[0];
      if (closest && (closest.distance_m ?? distanceMeters(here, closest)) > FAR_M) {
        setFar(closest);
        animateTo(farRegion(here));
      } else if (closest) {
        setSelected(near[0]);
        // Frame you and the nearest park together.
        fitTo([here, { latitude: near[0].latitude, longitude: near[0].longitude }]);
      } else {
        animateTo({ ...here, latitudeDelta: NEAR_DELTA, longitudeDelta: NEAR_DELTA });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, metro, fitTo, locate, showHomeCity, animateTo]);

  /* Pins for the visible area --------------------------------------------- */

  // The cache keeps the last pins up while the new area loads, and panning
  // back reuses earlier results.
  const onRegionChangeComplete = useCallback(() => scheduleSync(), [scheduleSync]);

  useEffect(
    () => () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    },
    [],
  );

  const pinsQuery = useParksInBounds(bounds);
  const inView = useMemo(() => pinsQuery.data ?? [], [pinsQuery.data]);
  const loadError = pinsQuery.isError;

  /* Filters and edge markers ------------------------------------------------- */

  // The nearest parks to the middle of the map, for edge markers. Rounded to
  // about 1 km so small pans reuse the same answer.
  const middle = useMemo(
    () =>
      bounds
        ? {
            latitude: (bounds.north + bounds.south) / 2,
            longitude: ((bounds.west + lngSpan(bounds) / 2 + 540) % 360) - 180,
          }
        : null,
    [bounds],
  );
  const centre = middle
    ? { lat: Math.round(middle.latitude * 100) / 100, lng: Math.round(middle.longitude * 100) / 100 }
    : null;
  const { data: nearCentre } = useQuery({
    queryKey: centre ? keys.parksNear(centre.lat, centre.lng, EDGE_CANDIDATES) : ['parks', 'near', 'none'],
    queryFn: () => parksNear(centre!.lat, centre!.lng, EDGE_CANDIDATES),
    enabled: centre !== null,
    staleTime: fresh.parks,
  });

  // Sessions, fees and time zones, only while a filter needs them (or the sheet is open to count).
  const facetIds = useMemo(
    () => [...inView.map((p) => p.id), ...(nearCentre ?? []).map((p) => p.id)],
    [inView, nearCentre],
  );
  const { data: facets, isFetching: facetsLoading } = useParkFacets(facetIds, needsFacets(filters) || filtersOpen);

  const passes = useCallback((p: ParkPin, f: MapFilters) => matchesFilters(p, facets?.get(p.id), f), [facets]);
  const pins = useMemo(() => inView.filter((p) => passes(p, filters)), [inView, passes, filters]);

  // How many parks in view the sheet's draft would show; null while it's still working that out.
  const countFor = useCallback(
    (draft: MapFilters) => {
      if (needsFacets(draft) && (!facets || facetsLoading)) return null;
      return inView.filter((p) => passes(p, draft)).length;
    },
    [facets, facetsLoading, inView, passes],
  );

  function applyFilters(next: MapFilters) {
    setFilters(next);
    setFiltersOpen(false);
    // A picked park that no longer matches closes its card.
    if (selected && !matchesFilters(selected, facets?.get(selected.id), next)) setSelected(null);
  }

  // The card needs hours and the metro's time zone for "open now". It's the
  // same cache entry the park page reads, so a park seen once shows at once.
  const { data: detail } = usePark(selected?.slug);

  // Far from every park, the button goes back to the ~100 km view and its card.
  async function recenter() {
    const here = me ?? (await locate(true));
    if (here && far) {
      setSelected(null);
      animateTo(farRegion(here));
    } else if (here) {
      animateTo({ ...here, latitudeDelta: NEAR_DELTA, longitudeDelta: NEAR_DELTA });
    } else {
      await showHomeCity();
    }
  }

  /* Far from every park ------------------------------------------------------ */

  const homeId = profile?.home_metro_area_id;
  const { data: homeMetro } = useMetro(homeId);
  const { data: homeParks } = useParksInMetro(homeId);
  const homeHasParks = Boolean(homeParks?.some((p) => p.latitude !== null));

  function goToClosest() {
    if (!far) return;
    setSelected(far);
    animateTo({
      latitude: far.latitude,
      longitude: far.longitude,
      latitudeDelta: NEAR_DELTA,
      longitudeDelta: NEAR_DELTA,
    });
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
  const farDistance =
    far && me ? formatDistance(far.distance_m ?? distanceMeters(me, far), metric, i18n.language) : null;
  // Only while there's nothing on the map: once you've moved somewhere with
  // parks, the card goes and the pins (and edge markers) take over.
  const showFar = far !== null && selected === null && inView.length === 0;
  // Always from you. (A park reached from an edge marker carries a
  // distance_m from the middle of the map, so it isn't used here.)
  const distance = selected && me ? formatDistance(distanceMeters(me, selected), metric, i18n.language) : null;

  // The nearest one or two matching parks just off the map, as tags at its
  // edge. They sit above the preview card and the locate button, and hide
  // under "No parks near you yet", which already names the closest park.
  const searchBottom = insets.top + space[2] + size.tapMin;
  const edgeTags = useMemo(() => {
    if (!bounds || !mapSize || !middle || showFar || !nearCentre) return [];
    const { width: w, height: h } = mapSize;
    // Clear of the search bar at the top, and of the locate button (which
    // sits above the preview card while one is open) at the bottom.
    const frame: Frame = {
      left: space[3],
      right: w - space[3],
      top: searchBottom + space[3],
      bottom: h - (selected ? LOCATE_ABOVE_CARD : LOCATE_BOTTOM) - size.tapMin - space[3],
    };
    if (frame.right - frame.left < 120 || frame.bottom - frame.top < 120) return [];
    const mid = { x: w / 2, y: h / 2 };
    const placed: (Point & { park: ParkPin; width: number; height: number; angle: number; edge: Edge })[] = [];
    for (const park of nearCentre) {
      if (placed.length >= EDGE_MAX) break;
      if (park.id === selected?.id) continue;
      if (distanceMeters(middle, park) > EDGE_MAX_M) continue;
      const p = project(bounds, w, h, park);
      if (isOnScreen(p, w, h)) continue;
      if (!passes(park, filters)) continue;
      const hit = edgePoint(mid, p, frame);
      const tagSize = tagSizes[park.id] ?? EDGE_GUESS;
      const at = tagPosition(hit, tagSize, frame);
      const box = { ...at, ...tagSize };
      if (placed.some((q) => overlaps(q, box))) continue;
      placed.push({ park, ...box, angle: hit.angle, edge: hit.edge });
    }
    return placed;
  }, [bounds, mapSize, middle, selected, showFar, nearCentre, passes, filters, tagSizes, searchBottom]);

  function goToEdgePark(park: ParkPin) {
    setSelected(park);
    animateTo({
      latitude: park.latitude,
      longitude: park.longitude,
      latitudeDelta: bounds ? bounds.north - bounds.south : NEAR_DELTA,
      longitudeDelta: bounds ? lngSpan(bounds) : NEAR_DELTA,
    });
  }

  const edgeDistance = (park: ParkPin) => {
    // From you while you're on the map; from the middle of the map when
    // you're looking somewhere else (planning a trip).
    const youreHere =
      me &&
      bounds &&
      mapSize &&
      isOnScreen(project(bounds, mapSize.width, mapSize.height, me), mapSize.width, mapSize.height);
    const from = youreHere ? me : middle;
    return from ? formatDistance(distanceMeters(from, park), metric, i18n.language) : null;
  };

  // Keep the selected pin on the map even when it's outside the last fetch.
  const shown = selected && !pins.some((p) => p.id === selected.id) ? [...pins, selected] : pins;

  return (
    <View
      style={styles.screen}
      onLayout={(e) => setMapSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: 32.75, longitude: -117.15, latitudeDelta: 0.4, longitudeDelta: 0.4 }}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={onRegionChangeComplete}
        // Tapping the map (not a pin) closes the preview card.
        onPress={(e) => {
          if (e.nativeEvent.action !== 'marker-press') setSelected(null);
        }}
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
        <View style={styles.searchRow}>
          <Pressable
            accessibilityRole="search"
            accessibilityLabel={t('map.search')}
            onPress={() => router.push('/city-search')}
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
          <FilterButton filters={filters} onPress={() => setFiltersOpen(true)} />
        </View>
        {loadError ? (
          <View style={[styles.notice, { backgroundColor: c.surfaceRaised, borderColor: c.statusClosed }]}>
            <Text variant="bodySm" color="statusClosed">
              {t('map.loadError')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Edge markers */}
      {edgeTags.map((tag) => (
        <EdgeTag
          key={tag.park.id}
          name={tag.park.display_name}
          distance={edgeDistance(tag.park)}
          angle={tag.angle}
          edge={tag.edge}
          left={tag.x}
          top={tag.y}
          onPress={() => goToEdgePark(tag.park)}
          onSize={(s) =>
            setTagSizes((prev) => {
              const old = prev[tag.park.id];
              if (old && Math.abs(old.width - s.width) < 1 && Math.abs(old.height - s.height) < 1) return prev;
              return { ...prev, [tag.park.id]: s };
            })
          }
        />
      ))}

      {/* Locate me */}
      <View
        style={[
          styles.locate,
          { bottom: selected ? LOCATE_ABOVE_CARD : showFar ? space[3] + farCardHeight + space[3] : LOCATE_BOTTOM },
        ]}
      >
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

      {/* No parks near you yet */}
      {showFar && far ? (
        <View
          accessibilityRole="summary"
          onLayout={(e) => setFarCardHeight(e.nativeEvent.layout.height)}
          style={[styles.card, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
        >
          <View style={styles.cardMain}>
            <Text variant="title">{t('map.noParksNear')}</Text>
            <Text variant="bodySm" color="textSecondary" numberOfLines={2}>
              {farDistance
                ? t('map.closest', { park: far.display_name, distance: farDistance })
                : t('map.closestNoDistance', { park: far.display_name })}
            </Text>
          </View>
          <View style={styles.farActions}>
            <Button label={t('map.goToClosest')} onPress={goToClosest} />
            {homeHasParks && homeMetro ? (
              <Button
                variant="secondary"
                label={t('map.goToCity', { city: homeMetro.name })}
                onPress={() => void showHomeCity()}
              />
            ) : null}
          </View>
        </View>
      ) : null}

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

      <FilterSheet
        visible={filtersOpen}
        filters={filters}
        onApply={applyFilters}
        onClose={() => setFiltersOpen(false)}
        countFor={countFor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  top: { position: 'absolute', left: space[4], right: space[4], gap: space[2] },
  searchRow: { flexDirection: 'row', gap: space[2] },
  search: {
    flex: 1,
    height: size.tapMin,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
  },
  notice: { borderWidth: stroke.rule, padding: space[2] },
  locate: { position: 'absolute', right: space[4] },
  square: {
    width: size.tapMin,
    height: size.tapMin,
    borderWidth: stroke.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  farActions: { gap: space[2] },
});
