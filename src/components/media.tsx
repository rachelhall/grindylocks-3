import { Image } from 'expo-image';
import { useVideoPlayer, type VideoPlayer, type VideoThumbnail, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
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

/** A picked photo or clip as a cropped thumbnail, filling its parent. */
export function MediaThumb({ uri, kind }: { uri: string; kind: 'photo' | 'video' }) {
  return kind === 'photo' ? (
    <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
  ) : (
    <ClipThumb uri={uri} />
  );
}

/* Previews while posting ------------------------------------------------------ */

type DraftMedia = { key: string; uri: string; kind: 'photo' | 'video'; width: number; height: number };

/** The size posts use for a slide, even when the picker didn't report one. */
function shapeOf(m: DraftMedia): { width: number; height: number } {
  return m.width > 0 && m.height > 0 ? m : { width: 1, height: 1 };
}

/**
 * A picked clip playing from the phone: muted and looping while it's the
 * slide showing. Tapping it turns its sound on or off. When autoplay is off
 * it waits for a tap on the play button.
 */
function LocalClip({ uri, active }: { uri: string; active: boolean }) {
  const { t } = useTranslation();
  const autoplay = useAutoplayAllowed();
  const focused = useIsFocused();
  const [started, setStarted] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'auto';
  });

  const live = active && focused;
  const shouldPlay = live && (autoplay || started);

  useEffect(() => {
    setMuted(player, !soundOn);
  }, [player, soundOn]);

  useEffect(() => {
    if (shouldPlay) player.play();
    else player.pause();
  }, [player, shouldPlay]);

  const waiting = live && !shouldPlay;
  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={waiting ? t('clip.play') : soundOn ? t('clip.mute') : t('clip.unmute')}
        onPress={() => (waiting ? setStarted(true) : setSoundOn((on) => !on))}
        style={StyleSheet.absoluteFill}
      >
        {waiting ? (
          <View style={styles.center} pointerEvents="none">
            <View style={styles.playButton}>
              <Icon name="play" color={brand.paper} size={28} />
            </View>
          </View>
        ) : null}
      </Pressable>
      <View style={[styles.tag, styles.previewSound]} pointerEvents="none">
        <Icon name={soundOn ? 'soundOn' : 'soundOff'} color={brand.paper} size={14} />
      </View>
    </>
  );
}

/** One picked item at the shape it will post at, letterboxed in ink. */
function DraftSlide({
  item,
  width,
  height,
  active,
  near,
}: {
  item: DraftMedia;
  width: number;
  height: number;
  active: boolean;
  /** Clips only load a player when they're the slide showing or next to it. */
  near: boolean;
}) {
  return (
    <View style={[styles.frame, { width, height }]}>
      {item.kind === 'photo' ? (
        <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
      ) : near ? (
        <LocalClip uri={item.uri} active={active} />
      ) : (
        <View style={styles.center}>
          <Icon name="video" color={brand.paper} />
        </View>
      )}
    </View>
  );
}

/**
 * The picked slides, full width and swipeable, the way the post will look.
 * The slide showing is controlled by the screen, so a strip of thumbnails or
 * a tag editor can follow it.
 */
export function DraftPager({
  items,
  width,
  index,
  onIndexChange,
  label,
}: {
  items: DraftMedia[];
  width: number;
  index: number;
  onIndexChange: (index: number) => void;
  /** Tag in the bottom left of the slide showing ("SLIDE 1 · 0:15"). */
  label?: string;
}) {
  const ref = useRef<ScrollView>(null);
  const height = carouselHeight(width, items.map(shapeOf));

  // A thumbnail tap moves the pager; a swipe tells the screen.
  useEffect(() => {
    ref.current?.scrollTo({ x: index * width, animated: true });
  }, [index, width]);

  return (
    <View style={{ width, height }}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        scrollEnabled={items.length > 1}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / width);
          if (next !== index) onIndexChange(next);
        }}
        style={{ width, height }}
      >
        {items.map((m, i) => (
          <DraftSlide
            key={m.key}
            item={m}
            width={width}
            height={height}
            active={i === index}
            near={Math.abs(i - index) <= 1}
          />
        ))}
      </ScrollView>
      {label ? <MediaTag label={label} style={styles.previewLabel} /> : null}
    </View>
  );
}

/** Square dots under a pager; the current slide's is wide and ink. */
export function PagerDots({ count, index }: { count: number; index: number }) {
  const c = useColors();
  if (count < 2) return null;
  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[styles.dot, i === index ? { width: 20, backgroundColor: c.text } : { backgroundColor: c.border }]}
        />
      ))}
    </View>
  );
}

/**
 * A picked item in the slide strip: thumbnail at its own shape, order
 * number, and remove on the one that's showing. Tapping it shows it above.
 */
export function StripThumb({
  uri,
  kind,
  width,
  height,
  number,
  selected,
  onPress,
  onRemove,
  label,
  removeLabel,
  actions,
}: {
  uri: string;
  kind: 'photo' | 'video';
  width: number;
  height: number;
  number: number;
  selected: boolean;
  onPress: () => void;
  onRemove: () => void;
  label: string;
  removeLabel: string;
  /** Screen reader actions, e.g. moving the slide. */
  actions?: { name: string; label: string; run: () => void }[];
}) {
  const c = useColors();
  return (
    <View style={[styles.stripItem, { width, height }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        accessibilityActions={actions?.map((a) => ({ name: a.name, label: a.label }))}
        onAccessibilityAction={(e) => actions?.find((a) => a.name === e.nativeEvent.actionName)?.run()}
        onPress={onPress}
        style={({ pressed }) => [
          styles.stripThumb,
          { backgroundColor: c.surfaceSunk, borderColor: selected ? c.text : 'transparent' },
          pressed && { opacity: 0.75 },
        ]}
      >
        <MediaThumb uri={uri} kind={kind} />
        <View
          style={[
            styles.number,
            selected
              ? { backgroundColor: c.accent, borderColor: c.onAccent }
              : { backgroundColor: c.surfaceRaised, borderColor: c.text },
          ]}
        >
          <Text variant="label" style={{ color: selected ? c.onAccent : c.text }}>
            {number}
          </Text>
        </View>
      </Pressable>
      {selected ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          onPress={onRemove}
          hitSlop={10}
          style={({ pressed }) => [styles.stripRemove, { backgroundColor: c.text }, pressed && { opacity: 0.75 }]}
        >
          <Icon name="close" color={c.surface} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  frame: { backgroundColor: brand.ink, overflow: 'hidden' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: space[2], padding: space[4] },
  tag: { position: 'absolute', backgroundColor: brand.ink, paddingHorizontal: 5, paddingVertical: 2 },
  tagBottomRight: { right: 8, bottom: 8 },
  tagTopRight: { right: 8, top: 8 },
  soundBadge: { right: 8, bottom: 36, paddingVertical: 4 },
  previewSound: { right: 12, bottom: 12, paddingVertical: 4 },
  previewLabel: { left: 12, bottom: 12 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8 },
  playButton: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.ink, borderWidth: stroke.rule, borderColor: brand.paper },
  card: { borderWidth: stroke.rule, padding: space[4], gap: space[3] },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  bar: { height: 6, alignSelf: 'stretch', overflow: 'hidden' },
  barFill: { height: 6 },
  stripItem: { position: 'relative' },
  stripThumb: { flex: 1, overflow: 'hidden', borderWidth: 3 },
  stripRemove: { position: 'absolute', right: -8, top: -8, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  number: {
    position: 'absolute',
    left: 3,
    top: 3,
    width: 22,
    height: 22,
    borderWidth: stroke.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
