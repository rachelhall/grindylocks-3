import { useLocalSearchParams } from 'expo-router';

import { ProfileView } from '@/components/profile';

/**
 * Someone's profile, opened from Search (and later from posts, tags and
 * regulars lists). People who blocked each other can't open each other's
 * profile: the database returns nothing, and the screen says it isn't
 * available.
 */
export default function Profile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return <ProfileView username={username ?? ''} />;
}
