import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickedTile } from '@/components/media';
import { Button, Icon } from '@/components/ui';
import { MAX_SLIDES, pickFromLibrary, type Rejection } from '@/lib/media';
import { usePostDraft } from '@/lib/post-draft';
import { Sentry } from '@/lib/sentry';
import { space, stroke, Text, useColors } from '@/theme';

const GRID_GAP = 3;

/**
 * New post, step 1 of 3 (Post-Media mockup): pick up to 10 photos and clips
 * from the camera roll, in order. Clips over 60 seconds are turned down with
 * a note to trim them in Photos first (no in-app trimming or Files source
 * yet). Next goes to tagging.
 */
export default function NewPostMedia() {
  const { t } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { items, setItems, addMedia } = usePostDraft();

  const [rejected, setRejected] = useState<Record<Rejection, number>>({ tooLong: 0, tooBig: 0, unsupported: 0 });
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_SLIDES - items.length;
  const tile = (width - space[6] * 2 - GRID_GAP * 2) / 3;
  const clips = items.filter((m) => m.kind === 'video').length;

  async function pick() {
    setPicking(true);
    setError(null);
    try {
      const result = await pickFromLibrary(remaining);
      const counts: Record<Rejection, number> = { tooLong: 0, tooBig: 0, unsupported: 0 };
      for (const r of result.rejected) counts[r.reason] += 1;
      setRejected(counts);
      addMedia(result.picked, MAX_SLIDES);
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.generic'));
    } finally {
      setPicking(false);
    }
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

      <ScrollView contentContainerStyle={styles.content}>
        {items.length > 0 ? (
          <View style={styles.grid}>
            {items.map((m, i) => (
              <PickedTile
                key={m.key}
                uri={m.uri}
                kind={m.kind}
                durationS={m.durationS}
                number={i + 1}
                size={tile}
                removeLabel={t('post.remove', { number: i + 1 })}
                onRemove={() => setItems((prev) => prev.filter((x) => x.key !== m.key))}
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
                  { width: tile, height: tile, borderColor: c.border },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Icon name="add" color={c.text} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Button label={t('post.addMedia')} onPress={pick} loading={picking} />
        )}

        {rejectionLines.length > 0 ? (
          <View style={styles.rejections} accessibilityLiveRegion="polite">
            {rejectionLines.map((line) => (
              <Text key={line} variant="bodySm" color="statusClosed">
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.surfaceRaised, borderTopColor: c.borderSubtle }]}>
        <View style={styles.counts}>
          <Text variant="headline">{t('post.selected', { count: items.length, max: MAX_SLIDES })}</Text>
          <Text variant="bodySm" color="textSecondary">
            {t('post.limits')}
          </Text>
        </View>
        {items.length > 0 ? (
          <Text variant="label" color="textSecondary">
            {t('post.mix', { clips, photos: items.length - clips })}
          </Text>
        ) : null}
      </View>
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
  },
  headerButton: { minWidth: 88, minHeight: 48 },
  content: { padding: space[6], gap: space[6] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  addTile: { borderWidth: stroke.rule, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  rejections: { gap: space[1] },
  counts: { flex: 1, gap: 2 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
    paddingVertical: space[4],
    borderTopWidth: stroke.hairline,
  },
});
