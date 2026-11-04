import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { ProfileView } from '@/components/profile';
import { usePageIdForHandle } from '@/lib/pages';
import { useColors } from '@/theme';

/**
 * Someone's profile, opened from Search (and later from posts, tags and
 * regulars lists). People who blocked each other can't open each other's
 * profile: the database returns nothing, and the screen says it isn't
 * available.
 *
 * Handles and usernames share one namespace (v2, brand and shop pages), so an
 * @mention of a page lands here first and is sent on to the page.
 */
export default function Profile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const c = useColors();
  const page = usePageIdForHandle(username);
  if (page.data) return <Redirect href={{ pathname: '/page/[handle]', params: { handle: username ?? '' } }} />;
  if (page.isPending && !page.isError) {
    return <View style={{ flex: 1, backgroundColor: c.surface }}><ActivityIndicator color={c.text} style={{ marginTop: 96 }} /></View>;
  }
  return <ProfileView username={username ?? ''} />;
}
