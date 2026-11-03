/**
 * A member's square profile photo, or the first two letters of their
 * username on a plain tile. Re-exported from profile.tsx, where it started.
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useAvatarUrl } from '@/lib/profiles';
import { Text, useColors } from '@/theme';

/** Square profile photo, or the first two letters of the username on a plain tile. */
export function Avatar({
  path,
  username,
  size: s = 84,
  localUri,
}: {
  path: string | null;
  username: string;
  size?: number;
  /** A photo picked but not saved yet (Edit profile). */
  localUri?: string | null;
}) {
  const c = useColors();
  const signed = useAvatarUrl(localUri ? null : path);
  const uri = localUri ?? signed;
  return (
    <View
      style={[styles.avatar, { width: s, height: s, backgroundColor: c.borderSubtle }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <Text variant="display" style={{ fontSize: Math.round(s * 0.36), lineHeight: Math.round(s * 0.4) }}>
          {username.slice(0, 2).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
