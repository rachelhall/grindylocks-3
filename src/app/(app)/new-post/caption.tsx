import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaTag } from '@/components/media';
import { TagSectionTitle, useTagSummary } from '@/components/tagging';
import { BackButton, Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { prepareForUpload } from '@/lib/media';
import { usePostDraft } from '@/lib/post-draft';
import { Sentry } from '@/lib/sentry';
import { createPost } from '@/lib/uploads';
import { uuid } from '@/lib/uuid';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

const CAPTION_MAX = 2200;

/**
 * New post, step 3 of 3 (Post-Caption mockup): the caption, a summary of
 * what's tagged, and Post it. The flow closes straight away and uploads carry
 * on in the background; Home shows their progress.
 */
export default function NewPostCaption() {
  const { t } = useTranslation();
  const c = useColors();
  const qc = useQueryClient();
  const { session, profile } = useAuth();
  const { items, park, caption, setCaption, names } = usePostDraft();
  const summary = useTagSummary(park?.id ?? null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first = items[0];

  async function post() {
    const metroAreaId = profile?.home_metro_area_id;
    if (!session || !metroAreaId || items.length === 0) return;
    setPosting(true);
    setError(null);
    try {
      const prepared = [];
      for (const m of items) {
        const slideId = uuid();
        prepared.push({ ...(await prepareForUpload(m, slideId)), slideId, tags: m.tags });
      }
      await createPost({
        userId: session.user.id,
        metroAreaId,
        parkId: park?.id ?? null,
        caption,
        media: prepared,
      });
      void qc.invalidateQueries({ queryKey: ['posts'] });
      router.dismissTo('/home');
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.network'));
      setPosting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="title" accessibilityRole="header">
          {t('post.captionTitle')}
        </Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.captionRow}>
          {first ? (
            <View style={[styles.thumb, { backgroundColor: c.surfaceSunk }]}>
              {first.kind === 'photo' ? (
                <Image source={{ uri: first.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={styles.center}>
                  <Icon name="video" color={c.textSecondary} size={20} />
                </View>
              )}
              {items.length > 1 ? <MediaTag label={`1 / ${items.length}`} style={styles.thumbTag} /> : null}
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
              style={[styles.caption, { color: c.text, backgroundColor: c.surfaceRaised, borderColor: c.border }]}
            />
          </View>
        </View>

        <View style={styles.tagged}>
          <TagSectionTitle>{t('tagging.whatsTagged')}</TagSectionTitle>
          <View style={{ backgroundColor: c.surfaceRaised }}>
            <View style={[styles.summaryRow, { borderBottomColor: c.surfaceSunk }]}>
              <Text variant="label" color="textSecondary" style={styles.summaryLabel}>
                {t('tagging.park')}
              </Text>
              <Text variant="body" style={[styles.flex, { fontFamily: fontFamily.sansSemiBold }]}>
                {park?.name ?? t('tagging.noPark')}
              </Text>
            </View>
            {items.map((m, i) => {
              const line = summary(m.tags, names);
              return (
                <View
                  key={m.key}
                  style={[
                    styles.summaryRow,
                    i < items.length - 1 && { borderBottomColor: c.surfaceSunk, borderBottomWidth: stroke.hairline },
                  ]}
                >
                  <Text variant="label" color="textSecondary" style={styles.summaryLabel}>
                    {t('tagging.slide', { number: i + 1 }).toUpperCase()}
                  </Text>
                  <Text variant="bodySm" color={line ? 'text' : 'textSecondary'} style={styles.flex}>
                    {line ?? t('tagging.noTags')}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text variant="bodySm" color="textSecondary">
            {t('tagging.editLater')}
          </Text>
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
            {posting ? t('post.preparing') : t('post.backgroundNote')}
          </Text>
        </View>
        <Button
          label={t('post.postIt')}
          onPress={post}
          loading={posting}
          disabled={items.length === 0}
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
  spacer: { width: 48 },
  content: { padding: space[4], gap: space[6] },
  captionRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  thumb: { width: 72, height: 92, overflow: 'hidden' },
  thumbTag: { left: 4, bottom: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, gap: 6 },
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
  tagged: { gap: space[2] },
  summaryRow: {
    flexDirection: 'row',
    gap: space[3],
    alignItems: 'flex-start',
    padding: space[3],
    borderBottomWidth: stroke.hairline,
    borderBottomColor: 'transparent',
  },
  summaryLabel: { width: 64, paddingTop: 3 },
  footer: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
