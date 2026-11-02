import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type PickedPark, ParkButton, ParkPickerModal, SlideTagEditor, TagSectionTitle } from '@/components/tagging';
import { Button, Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { videoThumbnailUrl } from '@/lib/media';
import { hasTags, type Post, type SlideTags, tagsOf, useEditPost, usePost } from '@/lib/posts';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, space, stroke, Text, useColors } from '@/theme';

const CAPTION_MAX = 2200;
const THUMB_W = 56;
const THUMB_H = 70;

/**
 * Edit post: the caption, the park and each slide's tags, after publishing.
 * The slides themselves can't change. Changing the park drops obstacle tags
 * from the old park (general types stay).
 */
export default function EditPost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const { data: post, isLoading } = usePost(id);
  const mine = post && session && post.authorId === session.user.id;

  if (post && mine) return <EditForm post={post} />;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <Button label={t('common.cancel')} variant="tertiary" onPress={() => router.back()} style={styles.headerButton} />
        <Text variant="title" accessibilityRole="header">
          {t('editPost.title')}
        </Text>
        <View style={styles.headerButton} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={styles.loading} color={c.text} />
      ) : (
        <Text variant="body" color="textSecondary" style={styles.missing}>
          {t('viewer.missing')}
        </Text>
      )}
    </SafeAreaView>
  );
}

/** Starts from the post as it is; nothing is saved until Save. */
function EditForm({ post }: { post: Post }) {
  const { t } = useTranslation();
  const c = useColors();
  const save = useEditPost(post);

  const [caption, setCaption] = useState(post.caption ?? '');
  const [park, setPark] = useState<PickedPark | null>(post.park ? { id: post.park.id, name: post.park.name } : null);
  const [tags, setTags] = useState<Record<string, SlideTags>>(() =>
    Object.fromEntries(post.slides.map((s) => [s.id, tagsOf(s)])),
  );
  const [names, setNames] = useState<Record<string, string>>(() => {
    const known: Record<string, string> = {};
    for (const s of post.slides) {
      if (s.filmer?.username) known[s.filmer.id] = s.filmer.username;
      for (const p of s.people) if (p.username) known[p.id] = p.username;
    }
    return known;
  });
  const [index, setIndex] = useState(0);
  const [parkOpen, setParkOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slide = post.slides[Math.min(index, post.slides.length - 1)];

  function pickPark(next: PickedPark | null) {
    if (next?.id !== park?.id) {
      setTags((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, obstacleId: null }])));
    }
    setPark(next);
  }

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ caption, parkId: park?.id ?? null, slides: tags });
      router.back();
    } catch (err) {
      Sentry.captureException(err);
      setError(t('errors.generic'));
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <Button label={t('common.cancel')} variant="tertiary" onPress={() => router.back()} style={styles.headerButton} />
        <Text variant="title" accessibilityRole="header">
          {t('editPost.title')}
        </Text>
        <Button label={t('editPost.save')} onPress={submit} loading={save.isPending} style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
            {error}
          </Text>
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

        <ParkButton park={park} onPress={() => setParkOpen(true)} />

        {post.slides.length > 1 ? (
          <View style={styles.section}>
            <TagSectionTitle>{t('tagging.slides')}</TagSectionTitle>
            <View style={styles.thumbs}>
              {post.slides.map((s, i) => {
                const on = i === index;
                const uri = s.kind === 'photo' ? s.photoUrl : s.videoId ? videoThumbnailUrl(s.videoId, 160) : null;
                const tagged = tags[s.id] ? hasTags(tags[s.id]) : false;
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={
                      tagged ? t('tagging.slideTagged', { number: i + 1 }) : t('tagging.slide', { number: i + 1 })
                    }
                    onPress={() => setIndex(i)}
                    style={[styles.thumbHit, on && { borderColor: c.text }]}
                  >
                    <View style={{ width: THUMB_W, height: THUMB_H, backgroundColor: c.surfaceSunk }}>
                      {uri ? (
                        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <View style={styles.center}>
                          <Icon name={s.kind === 'video' ? 'video' : 'photo'} color={c.textSecondary} size={16} />
                        </View>
                      )}
                    </View>
                    {tagged ? (
                      <View style={styles.tickBox}>
                        <Icon name="check" color={c.accent} size={11} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {slide && tags[slide.id] ? (
          <SlideTagEditor
            key={slide.id}
            parkId={park?.id ?? null}
            tags={tags[slide.id]}
            names={names}
            onChange={(next) => setTags((prev) => ({ ...prev, [slide.id]: next }))}
            onName={(pid, username) => setNames((prev) => ({ ...prev, [pid]: username }))}
          />
        ) : null}
      </ScrollView>

      <ParkPickerModal visible={parkOpen} current={park} onClose={() => setParkOpen(false)} onPick={pickPark} />
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
  loading: { marginTop: space[12] },
  missing: { padding: space[6] },
  content: { padding: space[4], gap: space[6], paddingBottom: space[12] },
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
  section: { gap: space[2] },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumbHit: { borderWidth: 3, borderColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
});
