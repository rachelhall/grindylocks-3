import { Image } from 'expo-image';
import { useVideoPlayer, type VideoPlayer, type VideoThumbnail, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router';

import { Button, Icon } from '@/components/ui';
import { carouselHeight, formatDuration, videoPlaybackUrl } from '@/lib/media';
import { toggleSound, useAutoplayAllowed, useSoundOn } from '@/lib/playback';
import { postProgress, postState, type PostJob, uploads } from '@/lib/uploads';
import { brand, space, stroke, Text, useColors } from '@/theme';

/* Slides ------------------------------------------------------------------- */

export type ViewSlide = {
  id: string;
  kind: 'photo' | 'video';
  width: number;
  height: number;
  durationS: number | null;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  /** Photos: a signed URL. */
  photoUrl?: string;
  /** Clips: the Stream video ID. */
  videoId?: string | null;
};

/** Small ink tag in a corner: a clip's length or "1 / 3". */
export function MediaTag({ label, style }: { label: string; style?: object }) {
  return (
    <View style={[styles.tag, style]}>
      <Text variant="label" style={{ color: brand.paper }}>
        {label}
      </Text>
    </View>
  );
}

/** The player is a native object; muting it is how its sound is set. */
function setMuted(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}

/**
 * A clip in a post. It plays muted and loops while it's the active clip
 * (its post is the one mostly on screen, and it's the slide showing), and
 * pauses otherwise. Tapping it turns sound on or off for every clip this
 * session. When autoplay is off (Low Data Mode, Reduce Motion, the phone's
 * auto-play setting), it waits for a tap on the play button.
 */
function VideoSlide({ videoId, active }: { videoId: string; active: boolean }) {
  const { t } = useTranslation();
  const url = videoPlaybackUrl(videoId);
  const soundOn = useSoundOn();
  const autoplay = useAutoplayAllowed();
  const focused = useIsFocused();
  const [started, setStarted] = useState(false);
  const player = useVideoPlayer(url ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    // Muted clips don't stop music that's already playing.
    p.audioMixingMode = 'auto';
  });

  const live = active && focused;
  const shouldPlay = live && (autoplay || started);

  // Scrolled away: the next time it comes back, autoplay rules apply again.
  const [wasLive, setWasLive] = useState(live);
  if (live !== wasLive) {
    setWasLive(live);
    if (!live) setStarted(false);
  }

  useEffect(() => {
    setMuted(player, !soundOn);
  }, [player, soundOn]);

  useEffect(() => {
    if (shouldPlay) player.play();
    else player.pause();
  }, [player, shouldPlay]);

  if (!url) return null;
  const waiting = live && !shouldPlay;
  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={waiting ? t('clip.play') : soundOn ? t('clip.mute') : t('clip.unmute')}
        onPress={() => (waiting ? setStarted(true) : toggleSound())}
        style={StyleSheet.absoluteFill}
      >
        {waiting || !live ? (
          <View style={styles.center} pointerEvents="none">
            <View style={styles.playButton}>
              <Icon name="play" color={brand.paper} size={28} />
            </View>
          </View>
        ) : null}
      </Pressable>
      <View style={[styles.tag, styles.soundBadge]} pointerEvents="none">
        <Icon name={soundOn ? 'soundOn' : 'soundOff'} color={brand.paper} size={14} />
      </View>
    </>
  );
}

/**
 * One slide at its original aspect ratio, letterboxed in an ink frame of
 * the given size. Never cropped.
 */
function Slide({ slide, width, height, active }: { slide: ViewSlide; width: number; height: number; active: boolean }) {
  const { t } = useTranslation();
  const ready = slide.status === 'ready';
  return (
    <View style={[styles.frame, { width, height }]}>
      {!ready ? (
        <View style={styles.center}>
          {slide.status === 'failed' ? null : <ActivityIndicator color={brand.paper} />}
          <Text variant="bodySm" style={{ color: brand.paper }}>
            {slide.status === 'failed' ? t('uploads.failed') : t('viewer.notReady')}
          </Text>
        </View>
      ) : slide.kind === 'photo' && slide.photoUrl ? (
        <Image
          source={{ uri: slide.photoUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          accessibilityIgnoresInvertColors
        />
      ) : slide.kind === 'video' && slide.videoId && videoPlaybackUrl(slide.videoId) ? (
        <VideoSlide videoId={slide.videoId} active={active} />
      ) : (
        <View style={styles.center}>
          <Icon name={slide.kind === 'video' ? 'video' : 'photo'} color={brand.paper} />
          <Text variant="bodySm" style={{ color: brand.paper, textAlign: 'center' }}>
            {slide.kind === 'video' ? t('viewer.videoUnavailable') : t('errors.generic')}
          </Text>
        </View>
      )}
      {slide.kind === 'video' && slide.durationS ? (
        <MediaTag label={formatDuration(slide.durationS)} style={styles.tagBottomRight} />
      ) : null}
    </View>
  );
}

/**
 * A post's slides. One slide shows on its own; several page sideways at a
 * fixed height taken from the tallest slide, so the post doesn't jump while
 * swiping.
 */
export function Carousel({
  slides,
  width,
  overlay,
  onIndexChange,
  active = true,
}: {
  slides: ViewSlide[];
  width: number;
  /** Whether this post may play its clip (the one mostly on screen in a feed). */
  active?: boolean;
  /** Tags drawn over the slide that's showing (its obstacle, its people). */
  overlay?: (index: number) => ReactNode;
  onIndexChange?: (index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const height = carouselHeight(width, slides);
  if (slides.length === 1) {
    return (
      <View>
        <Slide slide={slides[0]} width={width} height={height} active={active} />
        {overlay?.(0)}
      </View>
    );
  }
  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / width);
          setIndex(next);
          onIndexChange?.(next);
        }}
        style={{ width, height }}
      >
        {slides.map((s, i) => (
          <Slide key={s.id} slide={s} width={width} height={height} active={active && i === index} />
        ))}
      </ScrollView>
      <MediaTag label={`${index + 1} / ${slides.length}`} style={styles.tagTopRight} />
      {overlay?.(index)}
    </View>
  );
}

/* Upload status ------------------------------------------------------------ */

/** A post that's still uploading: progress, and retry or delete if it stopped. */
export function UploadCard({ job, onDiscard }: { job: PostJob; onDiscard: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const state = postState(job);
  const progress = postProgress(job);
  const done = job.slides.filter((s) => s.state === 'done' || s.state === 'processing').length;
  const failed = job.slides.find((s) => s.state === 'failed');

  const label =
    state === 'failed'
      ? t('uploads.failed')
      : state === 'processing'
        ? t('uploads.processing')
        : t('uploads.uploading', { done: Math.min(done + 1, job.slides.length), total: job.slides.length });

  const reason =
    failed?.error === 'tooLong'
      ? t('uploads.errorTooLong')
      : failed?.error === 'videoNotConfigured'
        ? t('uploads.errorVideoNotConfigured')
        : failed
          ? t('uploads.errorRejected')
          : null;

  return (
    <View
      style={[styles.card, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
      accessible={state !== 'failed'}
      accessibilityLabel={`${label}${job.caption ? `, ${job.caption}` : ''}`}
    >
      <View style={styles.cardRow}>
        <Icon name={state === 'failed' ? 'retry' : 'sync'} color={c.text} size={20} />
        <Text variant="headline" style={styles.flex}>
          {label}
        </Text>
        <Text variant="label" color="textSecondary">
          {Math.round(progress * 100)}%
        </Text>
      </View>
      {job.caption ? (
        <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
          {job.caption}
        </Text>
      ) : null}
      <View
        style={[styles.bar, { backgroundColor: c.borderSubtle }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
      >
        <View style={[styles.barFill, { backgroundColor: c.text, width: `${progress * 100}%` }]} />
      </View>
      {reason ? (
        <>
          <Text variant="bodySm" color="statusClosed">
            {reason}
          </Text>
          <View style={styles.cardRow}>
            <Button
              label={t('common.retry')}
              variant="secondary"
              onPress={() => uploads.retry(job.postId)}
              style={styles.flex}
            />
            <Button label={t('uploads.discard')} variant="tertiary" onPress={onDiscard} style={styles.flex} />
          </View>
        </>
      ) : null}
    </View>
  );
}

/**
 * A frame from a picked clip, for its tile in the new post screen. Made on
 * the phone from the clip itself; until it's ready the tile shows the clip
 * icon.
 */
function ClipThumb({ uri }: { uri: string }) {
  const c = useColors();
  const player = useVideoPlayer(uri);
  const [frame, setFrame] = useState<VideoThumbnail | null>(null);

  useEffect(() => {
    let alive = true;
    player
      .generateThumbnailsAsync(0.5, { maxWidth: 360, maxHeight: 360 })
      .then(([thumb]) => {
        if (alive && thumb) setFrame(thumb);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [player]);

  if (!frame) {
    return (
      <View style={styles.center}>
        <Icon name="video" color={c.textSecondary} />
      </View>
    );
  }
  return <Image source={frame} style={StyleSheet.absoluteFill} contentFit="cover" />;
}

/** A picked item in the new post screen: thumbnail, order number, remove. */
export function PickedTile({
  uri,
  kind,
  durationS,
  number,
  size,
  onRemove,
  removeLabel,
}: {
  uri: string;
  kind: 'photo' | 'video';
  durationS?: number;
  number: number;
  size: number;
  onRemove: () => void;
  removeLabel: string;
}) {
  const c = useColors();
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: c.surfaceSunk }]}>
      {kind === 'photo' ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <ClipThumb uri={uri} />
      )}
      <View style={[styles.number, { backgroundColor: c.accent, borderColor: c.onAccent }]}>
        <Text variant="label" style={{ color: c.onAccent }}>
          {number}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        onPress={onRemove}
        hitSlop={8}
        style={({ pressed }) => [styles.remove, { backgroundColor: c.surfaceRaised }, pressed && { opacity: 0.75 }]}
      >
        <Icon name="close" color={c.text} size={16} />
      </Pressable>
      {kind === 'video' && durationS ? (
        <MediaTag label={formatDuration(durationS)} style={styles.tagBottomLeft} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  frame: { backgroundColor: brand.ink, overflow: 'hidden' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: space[2], padding: space[4] },
  tag: { position: 'absolute', backgroundColor: brand.ink, paddingHorizontal: 5, paddingVertical: 2 },
  tagBottomLeft: { left: 6, bottom: 6 },
  tagBottomRight: { right: 8, bottom: 8 },
  tagTopRight: { right: 8, top: 8 },
  soundBadge: { right: 8, bottom: 36, paddingVertical: 4 },
  playButton: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.ink, borderWidth: stroke.rule, borderColor: brand.paper },
  card: { borderWidth: stroke.rule, padding: space[4], gap: space[3] },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  bar: { height: 6, alignSelf: 'stretch', overflow: 'hidden' },
  barFill: { height: 6 },
  tile: { overflow: 'hidden' },
  number: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 26,
    height: 26,
    borderWidth: stroke.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: { position: 'absolute', right: 4, top: 4, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
