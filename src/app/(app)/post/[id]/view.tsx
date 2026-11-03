import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaTag, WholeSlides } from '@/components/media';
import { ObstacleChip } from '@/components/post-card';
import { Icon } from '@/components/ui';
import { usePost } from '@/lib/posts';
import { brand, fontFamily, size, space, Text } from '@/theme';

/** Room for the close button and the author above the media. */
const TOP_BAR = 60;
/** Room for the obstacle tag below it. */
const BOTTOM_BAR = 56;

/**
 * A post's slides whole and uncropped, full screen on ink (Media framing
 * (v2) mockup, "Tap a post · the whole clip"). Feeds crop slides to the
 * post's frame; this is where the rest of the photo or clip is. Opens on
 * the slide the expand button was on (`slide`); clips have a progress bar
 * that seeks when tapped.
 */
export default function PostViewer() {
  const { id, slide } = useLocalSearchParams<{ id: string; slide?: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { data, isError } = usePost(id);
  // undefined while loading; null when the post is gone or couldn't load.
  const post = data ?? (isError ? null : undefined);
  const start = Number(slide) || 0;
  const [index, setIndex] = useState(start);

  const mediaHeight = height - insets.top - insets.bottom - TOP_BAR - BOTTOM_BAR;
  const current = post?.slides[index];
  const username = post?.author?.username ?? t('common.deletedUser');

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('viewer.close')}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Icon name="close" color={brand.paper} size={22} />
        </Pressable>
        {post ? (
          <View style={styles.who}>
            <Text variant="bodySm" numberOfLines={1} style={styles.username}>
              {username}
            </Text>
            {post.park ? (
              <Text variant="caption" numberOfLines={1} style={{ color: brand.pink }}>
                {post.park.name}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.who} />
        )}
        <View style={styles.close} />
      </View>

      {post === undefined ? (
        <View style={[styles.center, { height: mediaHeight }]}>
          <ActivityIndicator color={brand.paper} />
        </View>
      ) : post === null || post.slides.length === 0 ? (
        <View style={[styles.center, { height: mediaHeight }]}>
          <Text variant="body" style={{ color: brand.paper }}>
            {t('viewer.missing')}
          </Text>
        </View>
      ) : (
        <WholeSlides
          slides={post.slides}
          width={width}
          height={mediaHeight}
          initialIndex={start}
          onIndexChange={setIndex}
        />
      )}

      <View style={styles.bottom}>
        {current && post ? <ObstacleChip slide={current} parkSlug={post.park?.slug} accent /> : <View />}
        {post && post.slides.length > 1 ? (
          <MediaTag
            label={`${index + 1} / ${post.slides.length}`}
            style={styles.count}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: brand.ink },
  top: { height: TOP_BAR, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[3], gap: space[2] },
  close: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, alignItems: 'center' },
  username: { color: brand.paper, fontFamily: fontFamily.sansSemiBold },
  center: { alignItems: 'center', justifyContent: 'center' },
  bottom: { height: BOTTOM_BAR, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4] },
  count: { position: 'relative' },
  pressed: { opacity: 0.75 },
});
