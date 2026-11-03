import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { FrameEditor, StripThumb } from '@/components/media';
import { NewModeSwitch } from '@/components/meetup-compose';
import { Button, Icon } from '@/components/ui';
import { formatDuration, frameRatio, frameShapeLabel, MAX_SLIDES, pickFromLibrary, type Rejection } from '@/lib/media';
import { usePostDraft } from '@/lib/post-draft';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

const STRIP_H = 80;

/** Strip thumbnails take the post's frame shape, at most 4:3 wide. */
function stripWidth(ratio: number): number {
  return Math.round(STRIP_H * Math.min(4 / 3, 1 / ratio));
}

/**
 * New post, step 1 of 3 (Post-Media mockup, framing from the Media framing
 * (v2) mockup): the picked photos and clips, whole, with the post's frame
 * over the one showing to drag (the feed shows what's inside it), and a
 * strip below to switch, reorder and remove them. The first slide sets the
 * frame's shape for every slide, between 4:5 and 1.91:1. The system picker adds media (up to 10; clips
 * over 60 seconds are turned down with a note to trim them in Photos first).
 * Next goes to tagging.
 */
export default function NewPostMedia() {
  const { t } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { items, setItems, addMedia, setFrame, park } = usePostDraft();

  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<Record<Rejection, number>>({ tooLong: 0, tooBig: 0, unsupported: 0 });
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_SLIDES - items.length;
  const clips = items.filter((m) => m.kind === 'video').length;
  const index = Math.min(selected, Math.max(items.length - 1, 0));
  const current = items[index];
  const ratio = frameRatio(items.map((m) => ({ width: m.width || 1, height: m.height || 1 })));

  async function pick() {
    setPicking(true);
    setError(null);
    try {
      const result = await pickFromLibrary(remaining);
      const counts: Record<Rejection, number> = { tooLong: 0, tooBig: 0, unsupported: 0 };
      for (const r of result.rejected) counts[r.reason] += 1;
      setRejected(counts);
      if (result.picked.length > 0) {
        // Show the first new one.
        setSelected(items.length);
        addMedia(result.picked, MAX_SLIDES);
      }
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.generic'));
    } finally {
      setPicking(false);
    }
  }

  function remove(key: string) {
    setItems((prev) => prev.filter((x) => x.key !== key));
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
    setSelected(to);
  }

  const rejectionLines = (
    [
      ['tooLong', 'post.rejectedTooLong'],
      ['tooBig', 'post.rejectedTooBig'],
      ['unsupported', 'post.rejectedUnsupported'],
    ] as const
  )
    .filter(([key]) => rejected[key] > 0)
    .map(([key, msg]) => t(msg, { count: rejected[key] }));

  const label = current
    ? current.kind === 'video' && current.durationS
      ? t('tagging.slideClip', { number: index + 1, duration: formatDuration(current.durationS) })
      : t('tagging.slide', { number: index + 1 })
    : '';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <Button label={t('post.cancel')} variant="tertiary" onPress={() => router.back()} style={styles.headerButton} />
        <Text variant="title" accessibilityRole="header">
          {t('post.newTitle')}
        </Text>
        <Button
          label={t('post.next')}
          onPress={() => router.push('/new-post/tag')}
          disabled={items.length === 0}
          style={styles.headerButton}
        />
      </View>

      {items.length === 0 ? (
        // Meetups (v2): New asks Post or Meetup, until media is picked.
        <View style={styles.modeSwitch}>
          <NewModeSwitch mode="post" park={park} />
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.surfaceRaised }]}>
            <Icon name="addPhoto" color={c.text} size={32} />
          </View>
          <Button label={t('post.addMedia')} onPress={pick} loading={picking} style={styles.emptyButton} />
          <Text variant="bodySm" color="textSecondary">
            {t('post.limits')}
          </Text>
          <Messages lines={rejectionLines} error={error} />
        </View>
      ) : (
        <ScrollView scrollEnabled={!dragging} contentContainerStyle={styles.content}>
          {current ? (
            <FrameEditor
              key={current.key}
              media={current}
              ratio={ratio}
              at={current.frame}
              onChange={(frame) => setFrame(current.key, frame)}
              width={width}
              label={label.toUpperCase()}
              onDragging={setDragging}
            />
          ) : null}
          <View style={styles.frameNote}>
            <Icon name="info" color={c.textSecondary} size={16} />
            <Text variant="bodySm" color="textSecondary" style={styles.flex}>
              {t('framing.note')}
            </Text>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text variant="bodySm" accessibilityRole="header" style={styles.sectionTitle}>
                {t('tagging.slides').toUpperCase()}
              </Text>
              <Text variant="caption" color="textSecondary">
                {t('framing.shape', { shape: frameShapeLabel(ratio) })}
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
            >
              {items.map((m, i) => (
                <StripThumb
                  key={m.key}
                  uri={m.uri}
                  kind={m.kind}
                  width={stripWidth(ratio)}
                  height={STRIP_H}
                  number={i + 1}
                  selected={i === index}
                  onPress={() => setSelected(i)}
                  onRemove={() => remove(m.key)}
                  label={t('post.slideItem', { number: i + 1 })}
                  removeLabel={t('post.remove', { number: i + 1 })}
                  actions={[
                    ...(i > 0 ? [{ name: 'earlier', label: t('post.moveEarlier'), run: () => move(i, i - 1) }] : []),
                    ...(i < items.length - 1
                      ? [{ name: 'later', label: t('post.moveLater'), run: () => move(i, i + 1) }]
                      : []),
                  ]}
                />
              ))}
              {remaining > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('post.addMore')}
                  onPress={pick}
                  disabled={picking}
                  style={({ pressed }) => [
                    styles.addTile,
                    { borderColor: c.textSecondary },
                    (pressed || picking) && { opacity: 0.6 },
                  ]}
                >
                  <Icon name="add" color={c.text} />
                </Pressable>
              ) : null}
            </ScrollView>

            {items.length > 1 ? (
              <View style={styles.moveRow}>
                <MoveButton
                  label={t('post.moveEarlier')}
                  icon="chevronLeft"
                  disabled={index === 0}
                  onPress={() => move(index, index - 1)}
                />
                <MoveButton
                  label={t('post.moveLater')}
                  icon="chevron"
                  trailing
                  disabled={index === items.length - 1}
                  onPress={() => move(index, index + 1)}
                />
              </View>
            ) : null}

            <Messages lines={rejectionLines} error={error} />
          </View>
        </ScrollView>
      )}

      <View style={[styles.footer, { borderTopColor: c.borderSubtle }]}>
        <Text variant="bodySm" color="textSecondary" style={styles.flex}>
          {items.length > 0 ? t('post.selected', { count: items.length, max: MAX_SLIDES }) : t('post.limitsShort')}
        </Text>
        {items.length > 0 ? (
          <Text variant="label" color="textSecondary">
            {t('post.mix', {
              clips: t('post.clipCount', { count: clips }),
              photos: t('post.photoCount', { count: items.length - clips }),
            })}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function MoveButton({
  label,
  icon,
  trailing,
  disabled,
  onPress,
}: {
  label: string;
  icon: 'chevron' | 'chevronLeft';
  trailing?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const color = disabled ? c.textMuted : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.moveButton, pressed && { opacity: 0.6 }]}
    >
      {!trailing ? <Icon name={icon} color={color} size={14} /> : null}
      <Text variant="bodySm" style={{ color, fontFamily: fontFamily.sansSemiBold }}>
        {label}
      </Text>
      {trailing ? <Icon name={icon} color={color} size={14} /> : null}
    </Pressable>
  );
}

function Messages({ lines, error }: { lines: string[]; error: string | null }) {
  if (lines.length === 0 && !error) return null;
  return (
    <View style={styles.messages} accessibilityLiveRegion="polite">
      {lines.map((line) => (
        <Text key={line} variant="bodySm" color="statusClosed">
          {line}
        </Text>
      ))}
      {error ? (
        <Text variant="bodySm" color="statusClosed">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
  },
  headerButton: { minWidth: 88, minHeight: 48 },
  modeSwitch: { paddingHorizontal: space[4], paddingTop: space[2] },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], padding: space[6] },
  emptyIcon: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  emptyButton: { alignSelf: 'stretch' },
  content: { paddingBottom: space[6] },
  frameNote: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4], paddingTop: space[3] },
  section: { paddingHorizontal: space[4], paddingTop: space[4], gap: space[3] },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[3] },
  sectionTitle: { fontFamily: fontFamily.sansSemiBold, letterSpacing: 0.5 },
  // Room above and right for the remove button that sits on a thumbnail's corner.
  strip: { gap: space[2], alignItems: 'flex-end', paddingTop: 8, paddingRight: 8 },
  addTile: {
    width: 64,
    height: STRIP_H,
    borderWidth: stroke.rule,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveRow: { flexDirection: 'row', justifyContent: 'space-between' },
  moveButton: { minHeight: size.tapMin, flexDirection: 'row', alignItems: 'center', gap: space[1] },
  messages: { gap: space[1] },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: stroke.hairline,
  },
});
