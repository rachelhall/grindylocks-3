import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaTag } from '@/components/media';
import { ParkButton, ParkPickerModal, SlideTagEditor } from '@/components/tagging';
import { BackButton, Button, Icon, Toggle } from '@/components/ui';
import { formatDuration } from '@/lib/media';
import { type DraftItem, usePostDraft } from '@/lib/post-draft';
import { hasTags, NO_TAGS, type SlideTags } from '@/lib/posts';
import { brand, space, stroke, Text, useColors } from '@/theme';

const PREVIEW_W = 150;
const PREVIEW_H = 190;
const THUMB_W = 44;
const THUMB_H = 56;

function same(a: SlideTags, b: SlideTags): boolean {
  return (
    a.obstacleId === b.obstacleId &&
    a.obstacleType === b.obstacleType &&
    a.filmerId === b.filmerId &&
    a.peopleIds.join() === b.peopleIds.join()
  );
}

/** A picked photo, or a clip placeholder (the picker gives no clip frame). */
function Thumb({ item, width, height, label }: { item: DraftItem; width: number; height: number; label?: string }) {
  const c = useColors();
  return (
    <View style={{ width, height, backgroundColor: c.surfaceSunk, overflow: 'hidden' }}>
      {item.kind === 'photo' ? (
        <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={styles.center}>
          <Icon name="video" color={c.textSecondary} size={width > 60 ? 28 : 16} />
        </View>
      )}
      {label ? <MediaTag label={label} style={styles.previewTag} /> : null}
    </View>
  );
}

/**
 * New post, step 2 of 3 (Post-Tag mockup): the park for every slide, then
 * each slide's obstacle, people and filmer, with "same tags as slide N" to
 * copy the slide before. Everything here is optional.
 */
export default function NewPostTag() {
  const { t } = useTranslation();
  const c = useColors();
  const { items, setTags, park, setPark, names, addName } = usePostDraft();
  const [index, setIndex] = useState(0);
  const [parkOpen, setParkOpen] = useState(false);

  const current = items[Math.min(index, items.length - 1)];
  if (!current) {
    // The media step was emptied; nothing to tag.
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.header}>
          <BackButton />
        </View>
      </SafeAreaView>
    );
  }
  const position = items.indexOf(current);
  const previous = position > 0 ? items[position - 1] : null;
  const copying = previous ? hasTags(previous.tags) && same(previous.tags, current.tags) : false;
  const label =
    current.kind === 'video' && current.durationS
      ? t('tagging.slideClip', { number: position + 1, duration: formatDuration(current.durationS) })
      : t('tagging.slide', { number: position + 1 });

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="title" accessibilityRole="header">
          {t('tagging.title')}
        </Text>
        <Button label={t('post.next')} onPress={() => router.push('/new-post/caption')} style={styles.next} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ParkButton park={park} onPress={() => setParkOpen(true)} />

        <View style={styles.slides}>
          <Thumb item={current} width={PREVIEW_W} height={PREVIEW_H} label={label.toUpperCase()} />
          <View style={styles.slidesSide}>
            <Text variant="label" color="textSecondary">
              {t('tagging.slides')}
            </Text>
            <View style={styles.thumbs}>
              {items.map((m, i) => {
                const on = i === position;
                return (
                  <Pressable
                    key={m.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={
                      hasTags(m.tags)
                        ? t('tagging.slideTagged', { number: i + 1 })
                        : t('tagging.slide', { number: i + 1 })
                    }
                    onPress={() => setIndex(i)}
                    style={[styles.thumbHit, on && { borderColor: c.text }]}
                  >
                    <Thumb item={m} width={THUMB_W} height={THUMB_H} />
                    {hasTags(m.tags) ? (
                      <View style={styles.tickBox}>
                        <Icon name="check" color={c.accent} size={11} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <Text variant="caption" color="textSecondary">
              {t('tagging.optional')}
            </Text>
          </View>
        </View>

        {previous ? (
          <View style={[styles.sameRow, { backgroundColor: c.surfaceRaised }]}>
            <Text variant="body" style={styles.flex}>
              {t('tagging.sameAs', { number: position })}
            </Text>
            <Toggle
              value={copying}
              onChange={(on) => setTags(current.key, on ? { ...previous.tags } : NO_TAGS)}
              label={t('tagging.sameAs', { number: position })}
              fg={c.text}
            />
          </View>
        ) : null}

        <SlideTagEditor
          key={current.key}
          parkId={park?.id ?? null}
          tags={current.tags}
          names={names}
          onChange={(next) => setTags(current.key, next)}
          onName={addName}
        />
      </ScrollView>

      <ParkPickerModal
        visible={parkOpen}
        current={park}
        onClose={() => setParkOpen(false)}
        onPick={(p) => setPark(p)}
      />
    </SafeAreaView>
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
  },
  next: { minWidth: 88, minHeight: 48 },
  content: { padding: space[4], gap: space[4], paddingBottom: space[12] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewTag: { left: 8, bottom: 8 },
  slides: { flexDirection: 'row', gap: space[3] },
  slidesSide: { flex: 1, gap: 6 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumbHit: { borderWidth: 3, borderColor: 'transparent' },
  tickBox: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 18,
    height: 18,
    backgroundColor: brand.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sameRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    borderWidth: stroke.hairline,
    borderColor: 'transparent',
  },
});
