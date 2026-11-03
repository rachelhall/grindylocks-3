import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { MediaTag, MediaThumb } from '@/components/media';
import { MentionList, useCaptionMentions } from '@/components/mentions';
import { TagSectionTitle, useTagSummary } from '@/components/tagging';
import { BackButton, Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { prepareForUpload } from '@/lib/media';
import { type DraftItem, usePostDraft } from '@/lib/post-draft';
import { Sentry } from '@/lib/sentry';
import { createPost } from '@/lib/uploads';
import { uuid } from '@/lib/uuid';
import { fontFamily, space, stroke, Text, useColors } from '@/theme';

const CAPTION_MAX = 2200;
const THUMB_H = 160;

/** Slides keep their shape here, between 3:4 and 4:3. */
function thumbWidth(m: DraftItem): number {
  const ratio = m.width > 0 && m.height > 0 ? m.width / m.height : 1;
  return Math.round(THUMB_H * Math.min(4 / 3, Math.max(3 / 4, ratio)));
}

/**
 * New post, step 3 of 3 (Post-Caption mockup): the caption, a summary of
 * what's tagged, and Post it. The flow closes straight away and uploads carry
 * on in the background; Home shows their progress.
 *
 * Typing @ in the caption opens the mention list above the keyboard
 * (Mentions (v2) mockup, Nov 2): people tagged or credited in the draft
 * first, then people you follow, then regulars at the post's park. While
 * it's open, a line saying mentions are notified stands in for Post it.
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
  const input = useRef<TextInput>(null);

  const onPost = items.flatMap((m) => [
    ...(m.tags.filmerId && names[m.tags.filmerId]
      ? [{ person: { id: m.tags.filmerId, username: names[m.tags.filmerId], avatarPath: null }, reason: 'filmed' as const }]
      : []),
    ...m.tags.peopleIds
      .filter((id) => names[id])
      .map((id) => ({ person: { id, username: names[id], avatarPath: null }, reason: 'tagged' as const })),
  ]);
  const mentions = useCaptionMentions({
    userId: session?.user.id,
    text: caption,
    setText: setCaption,
    inputRef: input,
    onPost,
    parkId: park?.id,
  });
  const mentioning = mentions.candidates.length > 0;

  const clips = items.filter((m) => m.kind === 'video').length;

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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.header}>
          <BackButton />
          <Text variant="title" accessibilityRole="header">
            {t('post.captionTitle')}
          </Text>
          <View style={styles.spacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.slides}
            accessibilityLabel={t('post.mix', {
              clips: t('post.clipCount', { count: clips }),
              photos: t('post.photoCount', { count: items.length - clips }),
            })}
          >
            {items.map((m, i) => (
              <View
                key={m.key}
                style={[styles.slide, { width: thumbWidth(m), backgroundColor: c.surfaceSunk }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <MediaThumb uri={m.uri} kind={m.kind} />
                {items.length > 1 ? <MediaTag label={String(i + 1)} style={styles.slideTag} /> : null}
              </View>
            ))}
          </ScrollView>

          <View style={styles.field}>
            <TextInput
              ref={input}
              accessibilityLabel={t('post.captionLabel')}
              value={caption}
              onChangeText={setCaption}
              onSelectionChange={mentions.onSelectionChange}
              placeholder={t('post.captionPlaceholder')}
              placeholderTextColor={c.textMuted}
              selectionColor={c.accent}
              cursorColor={c.text}
              multiline
              maxLength={CAPTION_MAX}
              style={[styles.caption, { color: c.text, borderBottomColor: c.text }]}
            />
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

        {mentioning ? (
          <View>
            <MentionList
              candidates={mentions.candidates}
              typed={mentions.typed}
              parkName={park?.name ?? null}
              onPick={mentions.pick}
            />
            <View style={[styles.mentionHint, { backgroundColor: c.surfaceRaised, borderTopColor: c.border }]}>
              <Text variant="bodySm" color="textSecondary">
                {t('post.mentionHint')}
              </Text>
            </View>
          </View>
        ) : (
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
        )}
      </KeyboardAvoidingView>
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
  content: { paddingTop: space[4], paddingBottom: space[6], gap: space[6] },
  slides: { paddingHorizontal: space[4], gap: space[2], alignItems: 'flex-end' },
  slide: { height: THUMB_H, overflow: 'hidden' },
  slideTag: { left: 6, top: 6 },
  field: { paddingHorizontal: space[4] },
  caption: {
    minHeight: 72,
    borderBottomWidth: stroke.rule,
    paddingHorizontal: 0,
    paddingTop: space[1],
    paddingBottom: space[3],
    fontFamily: fontFamily.sans,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  tagged: { gap: space[2], paddingHorizontal: space[4] },
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
  mentionHint: { borderTopWidth: stroke.rule, paddingHorizontal: space[4], paddingVertical: space[2] },
});
