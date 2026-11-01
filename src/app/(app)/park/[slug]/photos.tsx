import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName, useActionSheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  LICENSE_OWN,
  LICENSE_PERMISSION,
  type ParkPhoto,
  useArchiveParkPhoto,
  useParkPhotos,
  useParkRole,
  useReorderParkPhotos,
} from '@/lib/park-photos';
import { usePark } from '@/lib/parks';
import { brand, colors, fontFamily, size, space, stroke, Text } from '@/theme';

/** The gallery is always on ink, whatever the theme. */
const g = colors.dark;
/** Unlit progress bars, as on the gallery mockup. */
const BAR_OFF = colors.light.textSecondary;
const THUMB_GAP = 6;
const CREDIT_HEIGHT = 56;

/**
 * Park photos, per the "Park photos · gallery" mockup: every photo in full
 * color at its own aspect ratio (never cropped or filtered), who took it and
 * when it was added, and a strip of thumbnails. Swipe between photos.
 * Contributors reorder and the uploader or an admin removes photos from More.
 */
export default function ParkPhotosScreen() {
  const { slug, index: startParam } = useLocalSearchParams<{ slug: string; index?: string }>();
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const { data: park } = usePark(slug);
  const { data: photos, isPending } = useParkPhotos(park?.id);
  const { canContribute, canModerate } = useParkRole(session?.user.id, park?.id);
  const reorder = useReorderParkPhotos(park?.id ?? '');
  const archive = useArchiveParkPhoto(park?.id ?? '');
  const { sheet, show: showActions } = useActionSheet();
  const list = useRef<FlatList<ParkPhoto>>(null);
  const [index, setIndex] = useState(() => Math.max(0, Number(startParam ?? 0) || 0));
  const [stageHeight, setStageHeight] = useState(0);

  const all = photos ?? [];
  const total = all.length;
  const current = Math.min(index, Math.max(0, total - 1));
  const photo = all[current];
  const userId = session?.user.id;

  const goTo = (i: number) => {
    setIndex(i);
    list.current?.scrollToIndex({ index: i, animated: true });
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/park/[slug]', params: { slug } }));

  const move = (from: number, to: number) => {
    const ids = all.map((p) => p.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorder.mutate(ids, { onError: () => Alert.alert(t('parkPhotos.reorderFailed')) });
    goTo(to);
  };

  const confirmRemove = (p: ParkPhoto) =>
    Alert.alert(t('parkPhotos.removeTitle'), t('parkPhotos.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('parkPhotos.remove'),
        style: 'destructive',
        onPress: () => {
          if (current >= total - 1) setIndex(Math.max(0, total - 2));
          archive.mutate(p.id, {
            onSuccess: () => {
              if (total <= 1) close();
            },
            onError: () => Alert.alert(t('parkPhotos.removeFailed')),
          });
        },
      },
    ]);

  const canRemove = photo ? canModerate || photo.uploadedBy === userId : false;
  const canMoveEarlier = canContribute && current > 0;
  const canMoveLater = canContribute && current < total - 1;
  const hasActions = canMoveEarlier || canMoveLater || canRemove;

  const openMore = () => {
    if (!photo) return;
    showActions({
      actions: [
        ...(canMoveEarlier
          ? [
              { label: t('parkPhotos.makeHeader'), onPress: () => move(current, 0) },
              { label: t('parkPhotos.moveEarlier'), onPress: () => move(current, current - 1) },
            ]
          : []),
        ...(canMoveLater ? [{ label: t('parkPhotos.moveLater'), onPress: () => move(current, current + 1) }] : []),
        ...(canRemove ? [{ label: t('parkPhotos.remove'), destructive: true, onPress: () => confirmRemove(photo) }] : []),
      ],
    });
  };

  const parkName = park?.display_name ?? '';
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' });
  // Three thumbnails fill the row; more scroll sideways.
  const thumbWidth = (width - space[4] * 2 - THUMB_GAP * 2) / 3;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: g.surface }]}>
      <StatusBar style="light" />

      <View style={styles.top}>
        <SquareButton icon="close" label={t('common.close')} onPress={close} />
        <View style={styles.titles}>
          <Text variant="title" numberOfLines={1} style={styles.parkName}>
            {parkName}
          </Text>
          <Text variant="label" style={{ color: g.textSecondary }}>
            {t('parkPhotos.galleryCount', { current: total ? current + 1 : 0, total })}
          </Text>
        </View>
        {hasActions ? (
          <SquareButton icon="more" label={t('park.more')} onPress={openMore} />
        ) : (
          <View style={styles.square} />
        )}
      </View>

      <View style={styles.stage} onLayout={(e) => setStageHeight(e.nativeEvent.layout.height)}>
        {isPending || !park ? (
          <ActivityIndicator color={g.text} />
        ) : total === 0 ? (
          <Text variant="body" style={[styles.empty, { color: g.textSecondary }]}>
            {t('parkPhotos.galleryEmpty')}
          </Text>
        ) : stageHeight > 0 ? (
          <FlatList
            ref={list}
            data={all}
            keyExtractor={(p) => p.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={current}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <PhotoPage
                photo={item}
                width={width}
                height={stageHeight}
                credit={t('parkPhotos.photoBy', { name: creditName(item) })}
                licenseLine={licenseLine(item)}
                added={t('parkPhotos.added', { date: dateFmt.format(new Date(item.createdAt)) })}
                alt={t('parkPhotos.alt', { park: parkName })}
              />
            )}
          />
        ) : null}
      </View>

      {total > 0 ? (
        <View style={styles.bottom}>
          <View
            style={styles.bars}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('parkPhotos.photoOf', { current: current + 1, total })}
          >
            {all.map((p, i) => (
              <View key={p.id} style={[styles.bar, { backgroundColor: i === current ? g.text : BAR_OFF }]} />
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
            {all.map((p, i) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityState={{ selected: i === current }}
                accessibilityLabel={
                  i === current ? t('parkPhotos.thumbShowing', { n: i + 1 }) : t('parkPhotos.thumb', { n: i + 1 })
                }
                onPress={() => goTo(i)}
                style={[
                  styles.thumb,
                  { width: thumbWidth, borderColor: i === current ? g.text : 'transparent', backgroundColor: g.surfaceRaised },
                ]}
              >
                {p.url ? (
                  <Image
                    source={{ uri: p.url, cacheKey: p.storagePath }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    accessibilityIgnoresInvertColors
                  />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
          {/* TODO(M4): link to the park's feed once park feeds exist. */}
          <Text variant="caption" style={{ color: g.textSecondary }}>
            {t('parkPhotos.swipeHint')}{' '}
            <Text variant="caption" style={{ color: g.accentText }} accessibilityState={{ disabled: true }}>
              {t('parkPhotos.seePosts', { park: parkName })}
            </Text>
          </Text>
        </View>
      ) : null}

      {sheet}
    </SafeAreaView>
  );
}

/** One photo, contained at its own aspect ratio, with its credit under it. */
function PhotoPage({
  photo,
  width,
  height,
  credit,
  licenseLine: license,
  added,
  alt,
}: {
  photo: ParkPhoto;
  width: number;
  height: number;
  credit: string;
  licenseLine: string | null;
  added: string;
  alt: string;
}) {
  // As wide as the screen unless that makes it taller than the space left.
  const maxH = Math.max(0, height - CREDIT_HEIGHT);
  let w = width;
  let h = (width * photo.height) / photo.width;
  if (h > maxH) {
    h = maxH;
    w = (maxH * photo.width) / photo.height;
  }
  return (
    <View style={[styles.page, { width, height }]}>
      <View style={{ width: w, height: h }}>
        {photo.url ? (
          <Image
            source={{ uri: photo.url, cacheKey: photo.storagePath }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityLabel={alt}
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
      <View style={[styles.credit, { width }]}>
        <View style={styles.flex}>
          {/* TODO(M3): link the @username to their profile once profiles exist. */}
          <Text variant="bodySm" style={{ color: g.text }}>
            {credit}
          </Text>
          {license ? (
            <Text variant="caption" style={{ color: g.textSecondary }}>
              {license}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" style={{ color: g.textSecondary }}>
          {added}
        </Text>
      </View>
    </View>
  );
}

/** "@username" when the uploader took it, else the photographer as written. */
function creditName(photo: ParkPhoto) {
  const isUploader =
    photo.uploaderUsername !== null && photo.photographer.toLowerCase() === photo.uploaderUsername.toLowerCase();
  return isUploader ? `@${photo.photographer}` : photo.photographer;
}

/** "CC BY-SA 4.0 · Wikimedia Commons" when the license needs crediting; null for own photos and permission. */
function licenseLine(photo: ParkPhoto): string | null {
  if (photo.license === LICENSE_OWN || photo.license === LICENSE_PERMISSION) return null;
  return [photo.license, photo.source].filter(Boolean).join(' · ');
}

function SquareButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.square, { backgroundColor: brand.paper }, pressed && styles.pressed]}
    >
      <Icon name={icon} color={brand.ink} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], padding: space[4] },
  titles: { flex: 1, alignItems: 'center', gap: 2 },
  parkName: { color: g.text, fontSize: 18, lineHeight: 20, fontFamily: fontFamily.display },
  square: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', paddingHorizontal: space[4] },
  page: { alignItems: 'center', justifyContent: 'center' },
  credit: {
    minHeight: CREDIT_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingTop: 14,
    paddingHorizontal: space[4],
  },
  bottom: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3] },
  bars: { flexDirection: 'row', gap: THUMB_GAP },
  bar: { flex: 1, height: 3 },
  thumbs: { gap: THUMB_GAP },
  thumb: { height: 64, borderWidth: stroke.rule, overflow: 'hidden' },
});
