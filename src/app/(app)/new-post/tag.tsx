import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { DraftPager, PagerDots } from '@/components/media';
import { Chip, ParkPickerModal, ParkRow, SlideTagRows } from '@/components/tagging';
import { BackButton, Button } from '@/components/ui';
import { formatDuration } from '@/lib/media';
import { usePostDraft } from '@/lib/post-draft';
import { hasTags, NO_TAGS, type SlideTags } from '@/lib/posts';
import { space, Text, useColors } from '@/theme';

function same(a: SlideTags, b: SlideTags): boolean {
  return (
    a.obstacleId === b.obstacleId &&
    a.obstacleType === b.obstacleType &&
    a.filmerId === b.filmerId &&
    a.peopleIds.join() === b.peopleIds.join()
  );
}

/**
 * New post, step 2 of 3 (Post-Tag mockup): the park for every slide, then
 * the slides full width and swipeable, the way the post will look. Under
 * the slide showing are its Obstacle, People and Filmer rows, and "Same as
 * slide N" to copy the slide before. Everything here is optional.
 */
export default function NewPostTag() {
  const { t } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { items, setTags, park, setPark, names, addName } = usePostDraft();
  const [selected, setSelected] = useState(0);
  const [parkOpen, setParkOpen] = useState(false);

  const index = Math.min(selected, Math.max(items.length - 1, 0));
  const current = items[index];
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
  const previous = index > 0 ? items[index - 1] : null;
  const copying = previous ? hasTags(previous.tags) && same(previous.tags, current.tags) : false;
  const label =
    current.kind === 'video' && current.durationS
      ? t('tagging.slideClip', { number: index + 1, duration: formatDuration(current.durationS) })
      : t('tagging.slide', { number: index + 1 });

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
        <ParkRow park={park} onPress={() => setParkOpen(true)} />

        <DraftPager
          items={items}
          width={width}
          index={index}
          onIndexChange={setSelected}
          label={label.toUpperCase()}
        />

        <View style={styles.under}>
          <PagerDots count={items.length} index={index} />
          {previous && hasTags(previous.tags) ? (
            <View style={styles.copyRow}>
              <Chip
                label={t('tagging.sameAsShort', { number: index })}
                picked={copying}
                onPress={() => setTags(current.key, copying ? NO_TAGS : { ...previous.tags })}
              />
            </View>
          ) : null}
        </View>

        <SlideTagRows
          key={current.key}
          slideNumber={index + 1}
          parkId={park?.id ?? null}
          tags={current.tags}
          names={names}
          onChange={(next) => setTags(current.key, next)}
          onName={addName}
        />

        <Text variant="bodySm" color="textSecondary" style={styles.hint}>
          {t('tagging.optional')}
        </Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
  },
  next: { minWidth: 88, minHeight: 48 },
  content: { paddingBottom: space[12] },
  under: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[1], gap: space[3] },
  copyRow: { flexDirection: 'row' },
  hint: { paddingHorizontal: space[4], paddingTop: space[4] },
});
