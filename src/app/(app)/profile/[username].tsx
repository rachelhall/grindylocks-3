import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/ui';
import { space, Text, useColors } from '@/theme';

/**
 * Someone's profile, opened from Search.
 * TODO(M3): build the real profile (disciplines, home park, masonry grid,
 * tagged and filmed tabs, follow button). This stub only shows the username.
 */
export default function Profile() {
  const { t } = useTranslation();
  const c = useColors();
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
      </View>
      <Text variant="display" accessibilityRole="header">
        {`@${username ?? ''}`}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('profile.soon')}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space[4], gap: space[3] },
  header: { flexDirection: 'row' },
});
