import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { type PickedPark, ParkPickerModal, ParkRow, SlideTagRows } from '@/components/tagging';
import { Icon } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatDuration, videoThumbnailUrl } from '@/lib/media';
import { hasTags, type Post, type SlideTags, tagsOf, useEditPost, usePost } from '@/lib/posts';
import { Sentry } from '@/lib/sentry';
import { brand, fontFamily, size, space, stroke, Text, useColors } from '@/theme';

const CAPTION_MAX = 2200;
const THUMB = 84;

/**
 * Edit post (Edit post mockup, Built from the brief, Nov 2): Cancel (✕) and
 * Save at the top; the park row, warning that changing it clears obstacle
 * tags from that park (general types stay); a strip of slide thumbnails
 * that picks which slide's Obstacle, People and Filmer rows you're editing
 * (the media itself can't change after posting); the caption; and a note
 * on who's notified.
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
      <Header />
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

/** ✕ on the left, the title, and Save (or a spacer) on the right. */
function Header({ right }: { right?: ReactNode }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
        onPress={() => router.back()}
        style={({ pressed }) => [styles.close, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
      >
        <Icon name="close" color={c.text} size={22} />
      </Pressable>
      <Text variant="title" accessibilityRole="header" style={styles.title}>
        {t('editPost.title')}
      </Text>
      {right ?? <View style={styles.close} />}
    </View>
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

  const at = Math.min(index, post.slides.length - 1);
  const slide = post.slides[at];

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
      <Header
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: save.isPending, disabled: save.isPending }}
            disabled={save.isPending}
            onPress={submit}
            style={({ pressed }) => [styles.save, { backgroundColor: c.text }, pressed && styles.pressed]}
          >
            {save.isPending ? (
              <ActivityIndicator color={c.surface} />
            ) : (
              <Text variant="body" style={{ color: c.surface, fontFamily: fontFamily.sansSemiBold }}>
                {t('editPost.save')}
              </Text>
            )}
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? (
          <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite" style={styles.pad}>
            {error}
          </Text>
        ) : null}

        <ParkRow park={park} onPress={() => setParkOpen(true)} line={t('tagging.parkLineEdit')} />

        <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.caption}>
          {t('editPost.slides')}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs} accessibilityRole="tablist">
          {post.slides.map((s, i) => {
            const on = i === at;
            const uri = s.kind === 'photo' ? s.photoUrl : s.videoId ? videoThumbnailUrl(s.videoId, 200) : null;
            const tagged = tags[s.id] ? hasTags(tags[s.id]) : false;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={
                  (s.kind === 'video' ? t('editPost.slideClip', { number: i + 1 }) : t('editPost.slidePhoto', { number: i + 1 })) +
                  (tagged ? `, ${t('tagging.slideTagged', { number: i + 1 })}` : '')
                }
                onPress={() => setIndex(i)}
                style={[
                  styles.thumb,
                  { backgroundColor: c.surfaceSunk },
                  on ? { borderWidth: 3, borderColor: c.border } : { borderWidth: stroke.hairline, borderColor: c.borderSubtle },
                ]}
              >
                {uri ? (
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={styles.center}>
                    <Icon name={s.kind === 'video' ? 'video' : 'photo'} color={c.textSecondary} size={20} />
                  </View>
                )}
                <View style={[styles.badge, styles.badgeNumber]}>
                  <Text variant="caption" style={styles.badgeText}>
                    {i + 1}
                  </Text>
                </View>
                {s.kind === 'video' && s.durationS ? (
                  <View style={[styles.badge, styles.badgeDuration]}>
                    <Text variant="caption" style={styles.badgeText}>
                      {formatDuration(s.durationS)}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <Text variant="label" color="textSecondary" accessibilityRole="header" style={[styles.caption, styles.tagsCaption]}>
          {t('tagging.slideTagsTitle', { number: at + 1 })}
        </Text>
        {slide && tags[slide.id] ? (
          <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
            <SlideTagRows
              key={slide.id}
              slideNumber={at + 1}
              parkId={park?.id ?? null}
              parkName={park?.name ?? null}
              tags={tags[slide.id]}
              names={names}
              onChange={(next) => setTags((prev) => ({ ...prev, [slide.id]: next }))}
              onName={(pid, username) => setNames((prev) => ({ ...prev, [pid]: username }))}
            />
          </View>
        ) : null}

        <View style={styles.field}>
          <Text variant="label" color="textSecondary">
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
            style={[styles.captionInput, { color: c.text, backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          />
        </View>

        <Text variant="bodySm" color="textSecondary" style={styles.footnote}>
          {t('editPost.footnote')}
        </Text>
      </ScrollView>

      <ParkPickerModal visible={parkOpen} current={park} onClose={() => setParkOpen(false)} onPick={pickPark} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pressed: { opacity: 0.75 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  title: { flexShrink: 1, textAlign: 'center' },
  close: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  save: { minHeight: size.tapMin, minWidth: size.tapMin, paddingHorizontal: space[4], alignItems: 'center', justifyContent: 'center' },
  loading: { marginTop: space[12] },
  missing: { padding: space[6] },
  content: { paddingBottom: space[12] },
  pad: { paddingHorizontal: 20, paddingBottom: space[2] },
  caption: { paddingHorizontal: 20, paddingTop: space[4], paddingBottom: space[2] },
  tagsCaption: { paddingTop: 18, paddingBottom: 6 },
  thumbs: { paddingHorizontal: 20, gap: 10 },
  thumb: { width: THUMB, height: THUMB, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', backgroundColor: brand.ink, paddingHorizontal: 5, paddingVertical: 1 },
  badgeNumber: { left: 0, top: 0 },
  badgeDuration: { right: 0, bottom: 0 },
  badgeText: { color: brand.paper, fontFamily: fontFamily.sansSemiBold, fontSize: 11, lineHeight: 14 },
  rows: { borderTopWidth: stroke.hairline },
  field: { gap: 6, paddingHorizontal: 20, paddingTop: 20 },
  captionInput: {
    minHeight: 96,
    borderWidth: stroke.rule,
    paddingHorizontal: space[3],
    paddingVertical: 10,
    fontFamily: fontFamily.sans,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  footnote: { paddingHorizontal: 20, paddingTop: 14 },
});
