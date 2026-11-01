import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickedTile } from '@/components/media';
import { Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  MAX_SLIDES,
  pickFromLibrary,
  type PickedMedia,
  prepareForUpload,
  type Rejection,
} from '@/lib/media';
import { Sentry } from '@/lib/sentry';
import { createPost } from '@/lib/uploads';
import { uuid } from '@/lib/uuid';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

const CAPTION_MAX = 2200;
const GRID_GAP = 3;

/**
 * Bare-bones new post (M1): pick up to 10 photos and clips, add a caption,
 * post. Park, obstacle and people tags come with the full posting flow in
 * M4. After "Post it" the screen closes and uploads carry on in the
 * background; the home screen shows their progress.
 */
export default function NewPost() {
  const { t } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { session, profile } = useAuth();

  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [rejected, setRejected] = useState<Record<Rejection, number>>({ tooLong: 0, tooBig: 0, unsupported: 0 });
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<'picking' | 'posting' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_SLIDES - media.length;
  const tile = (width - space[6] * 2 - GRID_GAP * 2) / 3;
  const clips = media.filter((m) => m.kind === 'video').length;

  async function pick() {
    setBusy('picking');
    setError(null);
    try {
      const result = await pickFromLibrary(remaining);
      const counts: Record<Rejection, number> = { tooLong: 0, tooBig: 0, unsupported: 0 };
      for (const r of result.rejected) counts[r.reason] += 1;
      setRejected(counts);
      setMedia((prev) => {
        const seen = new Set(prev.map((m) => m.key));
        return [...prev, ...result.picked.filter((m) => !seen.has(m.key))].slice(0, MAX_SLIDES);
      });
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.generic'));
    } finally {
      setBusy(null);
    }
  }

  async function post() {
    const metroAreaId = profile?.home_metro_area_id;
    if (!session || !metroAreaId || media.length === 0) return;
    setBusy('posting');
    setError(null);
    try {
      const prepared = [];
      for (const m of media) {
        const slideId = uuid();
        prepared.push({ ...(await prepareForUpload(m, slideId)), slideId });
      }
      await createPost({ userId: session.user.id, metroAreaId, caption, media: prepared });
      router.back();
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.network'));
      setBusy(null);
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
        <Button
          label={t('post.cancel')}
          variant="tertiary"
          onPress={() => router.back()}
          disabled={busy === 'posting'}
          style={styles.headerButton}
        />
        <Text variant="title">{t('post.newTitle')}</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {media.length > 0 ? (
          <View style={styles.grid}>
            {media.map((m, i) => (
              <PickedTile
                key={m.key}
                uri={m.uri}
                kind={m.kind}
                durationS={m.durationS}
                number={i + 1}
                size={tile}
                removeLabel={t('post.remove', { number: i + 1 })}
                onRemove={() => setMedia((prev) => prev.filter((x) => x.key !== m.key))}
              />
            ))}
            {remaining > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('post.addMore')}
                onPress={pick}
                disabled={busy !== null}
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
          <Button
            label={t('post.addMedia')}
            onPress={pick}
            loading={busy === 'picking'}
            disabled={busy === 'posting'}
          />
        )}

        <View style={styles.counts}>
          <Text variant="headline">{t('post.selected', { count: media.length, max: MAX_SLIDES })}</Text>
          <Text variant="bodySm" color="textSecondary">
            {t('post.limits')}
          </Text>
          {media.length > 0 ? (
            <Text variant="label" color="textSecondary">
              {t('post.mix', { clips, photos: media.length - clips })}
            </Text>
          ) : null}
        </View>

        {rejectionLines.length > 0 ? (
          <View style={styles.rejections} accessibilityLiveRegion="polite">
            {rejectionLines.map((line) => (
              <Text key={line} variant="bodySm" color="statusClosed">
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.field}>
          <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {t('post.captionLabel')}
          </Text>
          <TextInput
            accessibilityLabel={t('post.captionLabel')}
            value={caption}
            onChangeText={setCaption}
            placeholder={t('post.captionPlaceholder')}
            placeholderTextColor={c.textMuted}
            selectionColor={c.accent}
            cursorColor={c.text}
            multiline
            maxLength={CAPTION_MAX}
            style={[
              styles.caption,
              { color: c.text, backgroundColor: c.surfaceRaised, borderColor: c.border },
            ]}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <View style={styles.note}>
          <Icon name="sync" color={c.textSecondary} size={16} />
          <Text variant="bodySm" color="textSecondary" style={styles.flex}>
            {busy === 'posting' ? t('post.preparing') : t('post.backgroundNote')}
          </Text>
        </View>
        <Button
          label={t('post.postIt')}
          onPress={post}
          loading={busy === 'posting'}
          disabled={media.length === 0 || busy !== null}
          palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        />
      </View>
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
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
  headerButton: { minWidth: 88 },
  content: { padding: space[6], gap: space[6] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  addTile: { borderWidth: stroke.rule, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  counts: { gap: 2 },
  rejections: { gap: space[1] },
  field: { gap: 6 },
  caption: {
    minHeight: 96,
    borderWidth: stroke.rule,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    fontFamily: fontFamily.sans,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  footer: { paddingHorizontal: space[6], paddingBottom: space[4], gap: space[3] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
