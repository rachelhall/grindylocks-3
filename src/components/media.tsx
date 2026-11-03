import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, type VideoPlayer, type VideoThumbnail, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';

import { Button, Icon } from '@/components/ui';
import {
  CENTERED,
  coverRect,
  formatDuration,
  type FramePoint,
  frameHeight,
  MAX_HEIGHT_RATIO,
  videoPlaybackUrl,
} from '@/lib/media';
import { toggleSound, useAutoplayAllowed, useSoundOn } from '@/lib/playback';
import { postProgress, postState, type PostJob, uploads } from '@/lib/uploads';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

/* Slides ------------------------------------------------------------------- */

export type ViewSlide = {
  id: string;
  kind: 'photo' | 'video';
  width: number;
  height: number;
  /** Where the slide sits in its post's frame; centred if missing. */
  frame?: FramePoint;
  durationS: number | null;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  /** Photos: a signed URL. */
  photoUrl?: string;
  /** Clips: the playback key (a signed token) from `videoKeys`. */
  videoKey?: string | null;
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

/** Jumps a clip to a time, in seconds. */
function seek(player: VideoPlayer, seconds: number) {
  player.currentTime = Math.max(0, Math.min(player.duration || 0, seconds));
}

/** Where media is drawn inside its slide: a cover rect, or the whole slide. */
type MediaBox = { width: number; height: number; left: number; top: number } | null;

function boxStyle(box: MediaBox) {
  return box ? { position: 'absolute' as const, ...box } : StyleSheet.absoluteFill;
}

/**
 * A clip in a post. It plays muted and loops while it's the active clip
 * (its post is the one mostly on screen, and it's the slide showing), and
 * pauses otherwise. Tapping it turns sound on or off for every clip this
 * session. When autoplay is off (Low Data Mode, Reduce Motion, the phone's
 * auto-play setting), it waits for a tap on the play button.
 *
 * `box` places the video inside the slide (feeds crop it to the post's
 * frame); without one it's shown whole. `progress` adds a bar along the
 * bottom that seeks when tapped (the full-screen viewer).
 */
function VideoSlide({
  videoKey,
  active,
  box,
  progress = false,
}: {
  videoKey: string;
  active: boolean;
  box: MediaBox;
  progress?: boolean;
}) {
  const { t } = useTranslation();
  const url = videoPlaybackUrl(videoKey);
  const soundOn = useSoundOn();
  const autoplay = useAutoplayAllowed();
  const focused = useIsFocused();
  const [started, setStarted] = useState(false);
  const player = useVideoPlayer(url ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    // Muted clips don't stop music that's already playing.
    p.audioMixingMode = 'auto';
    if (progress) p.timeUpdateEventInterval = 0.25;
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
      <VideoView
        player={player}
        style={boxStyle(box)}
        contentFit={box ? 'cover' : 'contain'}
        nativeControls={false}
      />
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
      {progress ? <ClipProgress player={player} /> : null}
    </>
  );
}

/** How far a clip has played; tapping the bar jumps there. */
function ClipProgress({ player }: { player: VideoPlayer }) {
  const { t } = useTranslation();
  const update = useEvent(player, 'timeUpdate', null);
  const [barWidth, setBarWidth] = useState(0);
  const duration = player.duration || 0;
  const now = update?.currentTime ?? 0;
  const share = duration > 0 ? Math.min(1, now / duration) : 0;
  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel={t('viewer.position')}
      accessibilityValue={{ text: `${formatDuration(now)} / ${formatDuration(duration)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const step = e.nativeEvent.actionName === 'increment' ? 5 : -5;
        seek(player, now + step);
      }}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      onPress={(e) => {
        if (barWidth > 0 && duration > 0) seek(player, (e.nativeEvent.locationX / barWidth) * duration);
      }}
      style={styles.progressHit}
    >
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${share * 100}%` }]} />
      </View>
    </Pressable>
  );
}

/**
 * One slide. In feeds (`fit="frame"`) it fills the post's frame, cropped
 * where the poster framed it; in the full-screen viewer (`fit="whole"`) it
 * shows whole, letterboxed in ink.
 */
function Slide({
  slide,
  width,
  height,
  active,
  fit = 'frame',
}: {
  slide: ViewSlide;
  width: number;
  height: number;
  active: boolean;
  fit?: 'frame' | 'whole';
}) {
  const { t } = useTranslation();
  const ready = slide.status === 'ready';
  const box: MediaBox = fit === 'frame' ? coverRect({ width, height }, slide, slide.frame ?? CENTERED) : null;
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
          style={boxStyle(box)}
          contentFit={box ? 'cover' : 'contain'}
          accessibilityIgnoresInvertColors
        />
      ) : slide.kind === 'video' && slide.videoKey && videoPlaybackUrl(slide.videoKey) ? (
        <VideoSlide videoKey={slide.videoKey} active={active} box={box} progress={fit === 'whole'} />
      ) : (
        <View style={styles.center}>
          <Icon name={slide.kind === 'video' ? 'video' : 'photo'} color={brand.paper} />
          <Text variant="bodySm" style={{ color: brand.paper, textAlign: 'center' }}>
            {slide.kind === 'video' ? t('viewer.videoUnavailable') : t('errors.generic')}
          </Text>
        </View>
      )}
      {slide.kind === 'video' && slide.durationS && fit === 'frame' ? (
        <MediaTag label={formatDuration(slide.durationS)} style={styles.tagBottomRight} />
      ) : null}
    </View>
  );
}

/**
 * A post's slides in its frame: every slide shares the first slide's shape,
 * between 4:5 and 1.91:1, cropped where the poster framed it (v2, Nov 2).
 * Several slides page sideways. `onExpand` adds a button that opens the
 * full-screen viewer, where nothing is cropped.
 */
export function Carousel({
  slides,
  width,
  overlay,
  onIndexChange,
  onExpand,
  active = true,
}: {
  slides: ViewSlide[];
  width: number;
  /** Whether this post may play its clip (the one mostly on screen in a feed). */
  active?: boolean;
  /** Tags drawn over the slide that's showing (its obstacle, its people). */
  overlay?: (index: number) => ReactNode;
  onIndexChange?: (index: number) => void;
  /** Opens the slide showing, whole, in the full-screen viewer. */
  onExpand?: (index: number) => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const height = frameHeight(width, slides);
  const expand = onExpand ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={slides[index]?.kind === 'video' ? t('viewer.openClip') : t('viewer.openPhoto')}
      onPress={() => onExpand(index)}
      hitSlop={6}
      style={({ pressed }) => [styles.expand, pressed && { opacity: 0.75 }]}
    >
      <Icon name="expand" color={brand.paper} size={16} />
    </Pressable>
  ) : null;
  if (slides.length === 1) {
    return (
      <View>
        <Slide slide={slides[0]} width={width} height={height} active={active} />
        {overlay?.(0)}
        {expand}
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
      <MediaTag
        label={`${index + 1} / ${slides.length}`}
        style={onExpand ? styles.countBesideExpand : styles.tagTopRight}
      />
      {overlay?.(index)}
      {expand}
    </View>
  );
}

/**
 * A post's slides whole, one per page, for the full-screen viewer: nothing
 * cropped, clips with a progress bar. Opens on `initialIndex`.
 */
export function WholeSlides({
  slides,
  width,
  height,
  initialIndex = 0,
  onIndexChange,
}: {
  slides: ViewSlide[];
  width: number;
  height: number;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
}) {
  const start = Math.min(Math.max(initialIndex, 0), Math.max(slides.length - 1, 0));
  const [index, setIndex] = useState(start);
  return (
    <ScrollView
      horizontal
      pagingEnabled
      scrollEnabled={slides.length > 1}
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: start * width, y: 0 }}
      onMomentumScrollEnd={(e) => {
        const next = Math.round(e.nativeEvent.contentOffset.x / width);
        setIndex(next);
        onIndexChange?.(next);
      }}
      style={{ width, height }}
    >
      {slides.map((s, i) => (
        <Slide key={s.id} slide={s} width={width} height={height} active={i === index} fit="whole" />
      ))}
    </ScrollView>
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

type DraftMedia = {
  key: string;
  uri: string;
  kind: 'photo' | 'video';
  width: number;
  height: number;
  frame?: FramePoint;
};

/** The size posts use for a slide, even when the picker didn't report one. */
function shapeOf(m: { width: number; height: number }): { width: number; height: number } {
  return m.width > 0 && m.height > 0 ? m : { width: 1, height: 1 };
}

/**
 * A picked clip playing from the phone: muted and looping while it's the
 * slide showing. Tapping it turns its sound on or off. When autoplay is off
 * it waits for a tap on the play button.
 */
function LocalClip({ uri, active, box }: { uri: string; active: boolean; box: MediaBox }) {
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
      <VideoView player={player} style={boxStyle(box)} contentFit="cover" nativeControls={false} />
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

/** One picked item in the post's frame, cropped where it's framed. */
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
  const box = coverRect({ width, height }, shapeOf(item), item.frame ?? CENTERED);
  return (
    <View style={[styles.frame, { width, height }]}>
      {item.kind === 'photo' ? (
        <Image source={{ uri: item.uri }} style={boxStyle(box)} contentFit="cover" />
      ) : near ? (
        <LocalClip uri={item.uri} active={active} box={box} />
      ) : (
        <View style={styles.center}>
          <Icon name="video" color={brand.paper} />
        </View>
      )}
    </View>
  );
}

/**
 * The picked slides, full width and swipeable, the way the post will look in
 * a feed: every slide in the first slide's frame shape, cropped where it's
 * framed. The slide showing is controlled by the screen, so a strip of
 * thumbnails or a tag editor can follow it.
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
  const height = frameHeight(width, items.map(shapeOf));

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

/* Framing ---------------------------------------------------------------------- */

/** A picked clip in the frame editor: muted, looping, no controls. */
function EditorClip({ uri, style }: { uri: string; style: object }) {
  const autoplay = useAutoplayAllowed();
  const focused = useIsFocused();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'auto';
  });
  useEffect(() => {
    if (autoplay && focused) player.play();
    else player.pause();
  }, [player, autoplay, focused]);
  return <VideoView player={player} style={style} contentFit="fill" nativeControls={false} />;
}

/** One step of the screen reader's adjust actions, along the drag axis. */
const FRAME_STEP = 0.1;

/**
 * Framing a slide (Media framing (v2) mockup, "New post · drag to frame"):
 * the whole photo or clip, with the post's frame drawn over it in pink and
 * everything outside it dimmed. Dragging moves the frame; Center puts it
 * back in the middle. The feed shows what's inside the frame.
 *
 * `ratio` is the post's frame shape (height ÷ width, from the first slide).
 * Clips play from the phone (`kind: 'video'`); in Edit post a clip's frame
 * is set over a still from Stream, passed as a photo.
 */
export function FrameEditor({
  media,
  ratio,
  at,
  onChange,
  width,
  label,
  onDragging,
}: {
  media: { uri: string; kind: 'photo' | 'video'; width: number; height: number };
  ratio: number;
  at: FramePoint;
  onChange: (at: FramePoint) => void;
  width: number;
  /** Tag in the top left ("SLIDE 1 · 0:30"). */
  label?: string;
  /** Lets a screen pause its scroll view while the frame is dragged. */
  onDragging?: (dragging: boolean) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const height = Math.round(width * MAX_HEIGHT_RATIO);
  const shape = shapeOf(media);

  // The whole media, fitted inside the editor.
  const scale = Math.min(width / shape.width, height / shape.height);
  const shown = { width: shape.width * scale, height: shape.height * scale };
  const left = (width - shown.width) / 2;
  const top = (height - shown.height) / 2;

  // The frame: the largest `ratio`-shaped box inside the media.
  const win =
    shown.height / shown.width > ratio
      ? { width: shown.width, height: shown.width * ratio }
      : { width: shown.height / ratio, height: shown.height };
  const slackX = shown.width - win.width;
  const slackY = shown.height - win.height;
  const axis: 'x' | 'y' | null = slackY > 0.5 ? 'y' : slackX > 0.5 ? 'x' : null;

  // While dragging the frame moves here; the draft is updated on release.
  const [grab, setGrab] = useState<{ x0: number; y0: number; from: FramePoint } | null>(null);
  const [drag, setDrag] = useState<FramePoint | null>(null);
  const point = drag ?? at;
  const winLeft = left + slackX * point.x;
  const winTop = top + slackY * point.y;

  function moved(g: { x0: number; y0: number; from: FramePoint }, pageX: number, pageY: number): FramePoint {
    return {
      x: slackX > 0.5 ? clamp01(g.from.x + (pageX - g.x0) / slackX) : g.from.x,
      y: slackY > 0.5 ? clamp01(g.from.y + (pageY - g.y0) / slackY) : g.from.y,
    };
  }

  function stop() {
    setGrab(null);
    setDrag(null);
    onDragging?.(false);
  }

  // Plain responder props: the editor takes the touch (a scroll view around
  // it is paused while dragging) and moves the frame with the finger.
  const responder: Partial<ViewProps> = axis
    ? {
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderTerminationRequest: () => false,
        onResponderGrant: (e) => {
          setGrab({ x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, from: at });
          onDragging?.(true);
        },
        onResponderMove: (e) => {
          if (grab) setDrag(moved(grab, e.nativeEvent.pageX, e.nativeEvent.pageY));
        },
        onResponderRelease: (e) => {
          if (grab) onChange(moved(grab, e.nativeEvent.pageX, e.nativeEvent.pageY));
          stop();
        },
        onResponderTerminate: stop,
      }
    : {};

  const centered = Math.abs(point.x - 0.5) < 0.001 && Math.abs(point.y - 0.5) < 0.001;
  const along = axis === 'x' ? point.x : point.y;
  const shade = { position: 'absolute' as const, backgroundColor: c.overlay };

  return (
    <View {...responder} style={[styles.editor, { width, height }]}>
      {media.kind === 'photo' ? (
        <Image
          source={{ uri: media.uri }}
          style={{ position: 'absolute', left, top, width: shown.width, height: shown.height }}
          contentFit="fill"
        />
      ) : (
        <EditorClip uri={media.uri} style={{ position: 'absolute', left, top, width: shown.width, height: shown.height }} />
      )}

      {/* Dim everything outside the frame. */}
      <View pointerEvents="none" style={[shade, { left, top, width: shown.width, height: winTop - top }]} />
      <View
        pointerEvents="none"
        style={[shade, { left, top: winTop + win.height, width: shown.width, height: top + shown.height - (winTop + win.height) }]}
      />
      <View pointerEvents="none" style={[shade, { left, top: winTop, width: winLeft - left, height: win.height }]} />
      <View
        pointerEvents="none"
        style={[shade, { left: winLeft + win.width, top: winTop, width: left + shown.width - (winLeft + win.width), height: win.height }]}
      />

      <View
        accessible
        accessibilityRole={axis ? 'adjustable' : undefined}
        accessibilityLabel={t('framing.frameLabel')}
        accessibilityHint={axis ? t(axis === 'y' ? 'framing.hintVertical' : 'framing.hintHorizontal') : undefined}
        accessibilityValue={axis ? { min: 0, max: 100, now: Math.round(along * 100) } : { text: t('framing.fits') }}
        accessibilityActions={axis ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
        onAccessibilityAction={(e) => {
          if (!axis) return;
          const step = e.nativeEvent.actionName === 'increment' ? FRAME_STEP : -FRAME_STEP;
          onChange(axis === 'x' ? { ...at, x: clamp01(at.x + step) } : { ...at, y: clamp01(at.y + step) });
        }}
        style={[styles.window, { left: winLeft, top: winTop, width: win.width, height: win.height, borderColor: c.accent }]}
      >
        <View pointerEvents="none" style={[styles.third, { left: '33.33%', top: 0, bottom: 0, width: 1 }]} />
        <View pointerEvents="none" style={[styles.third, { left: '66.66%', top: 0, bottom: 0, width: 1 }]} />
        <View pointerEvents="none" style={[styles.third, { top: '33.33%', left: 0, right: 0, height: 1 }]} />
        <View pointerEvents="none" style={[styles.third, { top: '66.66%', left: 0, right: 0, height: 1 }]} />
        {axis && !drag ? (
          <View pointerEvents="none" style={styles.dragHint}>
            <Icon name={axis === 'y' ? 'dragVertical' : 'dragHorizontal'} color={brand.paper} size={16} />
            <Text variant="bodySm" style={{ color: brand.paper, fontFamily: fontFamily.sansSemiBold }}>
              {t('framing.drag')}
            </Text>
          </View>
        ) : null}
      </View>

      {label ? <MediaTag label={label} style={styles.editorLabel} /> : null}
      {axis ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('framing.centerLabel')}
          accessibilityState={{ disabled: centered }}
          disabled={centered}
          onPress={() => onChange(CENTERED)}
          style={({ pressed }) => [styles.recenter, (pressed || centered) && { opacity: centered ? 0.5 : 0.75 }]}
        >
          <Icon name="recenter" color={brand.paper} size={16} />
          <Text variant="label" style={{ color: brand.paper }}>
            {t('framing.center')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

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
  // The full-screen viewer opens from the top right; "1 / 3" moves beside it.
  expand: { position: 'absolute', right: 8, top: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.ink },
  countBesideExpand: { right: 46, top: 8, paddingVertical: 7 },
  progressHit: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, justifyContent: 'flex-end', paddingHorizontal: space[4], paddingBottom: 10 },
  progressTrack: { height: 4, backgroundColor: 'rgba(242,239,230,0.35)' },
  progressFill: { height: 4, backgroundColor: brand.paper },
  editor: { backgroundColor: brand.ink, overflow: 'hidden' },
  window: { position: 'absolute', borderWidth: 3 },
  third: { position: 'absolute', backgroundColor: 'rgba(250,248,242,0.5)' },
  dragHint: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -16, height: 32, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, backgroundColor: brand.ink },
  editorLabel: { left: 12, top: 12 },
  recenter: { position: 'absolute', right: 12, top: 12, minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, backgroundColor: brand.ink, borderWidth: stroke.hairline, borderColor: 'rgba(242,239,230,0.35)' },
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
