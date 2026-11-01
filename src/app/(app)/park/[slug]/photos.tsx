import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet, Icon, type SheetAction } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { OWN_SOURCE, type ParkPhoto, useParkPhotoMutations, useParkPhotos } from '@/lib/park-photos';
import { usePark } from '@/lib/parks';
import { canContribute, canModerate, roleAtPark, useMyRoles } from '@/lib/roles';
import { brand, colors, fontFamily, size, space, stroke, Text } from '@/theme';

// The gallery is always on ink, whatever the theme.
const ink = brand.ink;
const paper = brand.paper;
const paperButton = colors.light.surfaceRaised;
const secondary = colors.dark.textSecondary;
const link = colors.dark.accentText;
const track = colors.light.textSecondary;

const GUTTER = space[4];
const THUMB_GAP = 6;

/**
 * Park photos, full screen on ink, per the "Park photos · gallery" mockup:
 * each photo in full color at its own aspect ratio (never cropped or
 * filtered), its credit and date, progress bars and thumbnails. Opened from
 * the park page header. The credit shows only here.
 */
export default function ParkGallery() {
  const { slug, start } = useLocalSearchParams<{ slug: string; start?: string }>();
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const userId = session?.user.id;

  const { data: park } = usePark(slug);
  const { data: photos, isPending } = useParkPhotos(park?.id ?? undefined);
  const { data: roles } = useMyRoles(userId);
  const role = park ? roleAtPark(roles, park) : null;
  const { makeFirst, archive } = useParkPhotoMutations(park?.id ?? undefined, userId);

  const list = photos ?? [];
  const [picked, setPicked] = useState(() => Math.max(0, Number(start) || 0));
  // Stays on a real photo when the list shrinks (an archived photo).
  const index = Math.min(picked, Math.max(list.length - 1, 0));
  const [stageHeight, setStageHeight] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const pager = useRef<FlatList<ParkPhoto>>(null);
  // A thumbnail tap or "make header photo" scrolls the pager here.
  const [jump, setJump] = useState<{ to: number } | null>(null);

  useEffect(() => {
    if (photos && photos.length === 0) router.back();
  }, [photos]);

  useEffect(() => {
    if (jump) pager.current?.scrollToOffset({ offset: jump.to * width, animated: true });
  }, [jump, width]);

  const current = list[index];
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric' });

  const goTo = (i: number) => {
    setPicked(i);
    setJump({ to: i });
  };

  const onSwipeEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setPicked(Math.max(0, Math.min(i, list.length - 1)));
  };

  const sourceLabel = (source: string) =>
    source === OWN_SOURCE
      ? t('parkPhotos.sourceOwn')
      : source.startsWith('permission from ')
        ? t('parkPhotos.sourcePermission', { park: source.slice('permission from '.length) })
        : source;
  const licenseLabel = (license: string) =>
    license === 'own' ? t('parkPhotos.licenseOwn') : license === 'permission' ? t('parkPhotos.licensePermission') : license;

  const actions: SheetAction[] = current
    ? [
        {
          label: t('parkPhotos.details'),
          icon: 'info',
          onPress: () =>
            Alert.alert(
              t('parkPhotos.details'),
              [
                t('parkPhotos.detailPhotographer', { name: current.photographer }),
                t('parkPhotos.detailSource', { source: sourceLabel(current.source) }),
                t('parkPhotos.detailLicense', { license: licenseLabel(current.license) }),
              ].join('\n'),
            ),
        },
        ...(canContribute(role) && index > 0
          ? [
              {
                label: t('parkPhotos.makeFirst'),
                icon: 'star' as const,
                onPress: () => {
                  makeFirst.mutate(current.id);
                  goTo(0);
                },
              },
            ]
          : []),
        ...(canModerate(role) || current.uploaded_by === userId
          ? [
              {
                label: t('parkPhotos.archive'),
                icon: 'archive' as const,
                destructive: true,
                onPress: () =>
                  Alert.alert(t('parkPhotos.archiveTitle'), t('parkPhotos.archiveBody'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('parkPhotos.archive'), style: 'destructive', onPress: () => archive.mutate(current.id) },
                  ]),
              },
            ]
          : []),
      ]
    : [];

  const thumbWidth =
    list.length > 0 && list.length <= 4
      ? (width - GUTTER * 2 - THUMB_GAP * (list.length - 1)) / list.length
      : 72;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: ink }]}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <SquareButton icon="close" label={t('common.close')} onPress={() => router.back()} />
        <View style={styles.titles}>
          <Text variant="title" numberOfLines={1} style={styles.parkName}>
            {park?.display_name ?? ''}
          </Text>
          <Text variant="label" style={{ color: secondary }}>
            {t('parkPhotos.position', { current: list.length ? index + 1 : 0, total: list.length })}
          </Text>
        </View>
        {actions.length > 0 ? (
          <SquareButton icon="more" label={t('park.more')} onPress={() => setMoreOpen(true)} />
        ) : (
          <View style={styles.square} />
        )}
      </View>

      <View style={styles.stage} onLayout={(e: LayoutChangeEvent) => setStageHeight(e.nativeEvent.layout.height)}>
        {isPending || !park ? (
          <ActivityIndicator color={paper} />
        ) : stageHeight > 0 ? (
          <FlatList
            ref={pager}
            data={list}
            keyExtractor={(p) => p.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(index, Math.max(list.length - 1, 0))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onSwipeEnd}
            renderItem={({ item }) => (
              <PhotoPage
                photo={item}
                width={width}
                stageHeight={stageHeight}
                added={t('parkPhotos.added', { date: dateFmt.format(new Date(item.created_at)) })}
              />
            )}
          />
        ) : null}
      </View>

      <View style={styles.bottom}>
        <View
          style={styles.progress}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('parkPhotos.photoOf', { current: index + 1, total: list.length })}
        >
          {list.map((p, i) => (
            <View key={p.id} style={[styles.bar, { backgroundColor: i === index ? paper : track }]} />
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {list.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected: i === index }}
              accessibilityLabel={t('parkPhotos.photoOf', { current: i + 1, total: list.length })}
              onPress={() => goTo(i)}
              style={[styles.thumb, { width: thumbWidth, borderColor: i === index ? paper : 'transparent' }]}
            >
              <Image
                source={p.url ? { uri: p.url, cacheKey: p.storage_path } : null}
                contentFit="cover"
                style={styles.fill}
                accessibilityIgnoresInvertColors
              />
            </Pressable>
          ))}
        </ScrollView>
        <Text variant="caption" style={{ color: secondary }}>
          {t('parkPhotos.swipeHint')}
        </Text>
        {/* TODO(M4): open the park's feed once park feeds exist. */}
        <Text variant="caption" accessibilityRole="link" accessibilityState={{ disabled: true }} style={{ color: link }}>
          {t('parkPhotos.seePosts', { park: park?.display_name ?? '' })}
        </Text>
      </View>

      <ActionSheet visible={moreOpen} actions={actions} onClose={() => setMoreOpen(false)} />
    </SafeAreaView>
  );
}

/** One photo, contained at its own aspect ratio, with its credit under it. */
function PhotoPage({
  photo,
  width,
  stageHeight,
  added,
}: {
  photo: ParkPhoto;
  width: number;
  stageHeight: number;
  added: string;
}) {
  const { t } = useTranslation();
  const creditHeight = 34;
  const height = Math.min((width * photo.height) / photo.width, stageHeight - creditHeight);
  const byUploader = photo.uploader !== null && photo.photographer === photo.uploader;

  return (
    <View style={[styles.page, { width, height: stageHeight }]}>
      <Image
        source={photo.url ? { uri: photo.url, cacheKey: photo.storage_path } : null}
        contentFit="contain"
        transition={150}
        style={{ width, height }}
        accessibilityLabel={t('parkPhotos.photoAlt')}
        accessibilityIgnoresInvertColors
      />
      <View style={styles.credit}>
        <Text variant="bodySm" style={[styles.flex, { color: paper }]} numberOfLines={1}>
          {t('parkPhotos.photoBy')}{' '}
          {byUploader ? (
            <Text
              variant="bodySm"
              accessibilityRole="link"
              style={{ color: link }}
              onPress={() => router.push({ pathname: '/profile/[username]', params: { username: photo.uploader! } })}
            >
              {`@${photo.uploader}`}
            </Text>
          ) : (
            photo.photographer
          )}
        </Text>
        <Text variant="caption" style={{ color: secondary }}>
          {added}
        </Text>
      </View>
    </View>
  );
}

function SquareButton({ icon, label, onPress }: { icon: 'close' | 'more'; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.square, { backgroundColor: paperButton }, pressed && styles.pressed]}
    >
      <Icon name={icon} color={ink} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  fill: { width: '100%', height: '100%' },
  pressed: { opacity: 0.75 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[4], gap: space[3] },
  square: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, alignItems: 'center', gap: 2 },
  parkName: { color: paper, fontFamily: fontFamily.display, fontSize: 18, lineHeight: 20 },
  stage: { flex: 1, justifyContent: 'center' },
  page: { justifyContent: 'center' },
  credit: {
    paddingTop: 14,
    paddingHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space[3],
  },
  bottom: { paddingHorizontal: GUTTER, paddingBottom: space[4], gap: space[3] },
  progress: { flexDirection: 'row', gap: THUMB_GAP },
  bar: { flex: 1, height: 3 },
  thumbs: { gap: THUMB_GAP },
  thumb: { height: 64, borderWidth: stroke.rule, backgroundColor: ink, overflow: 'hidden' },
});
