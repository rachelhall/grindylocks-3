import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton } from '@/components/ui';
import { space, Text, useColors } from '@/theme';

/**
 * Opened from the bell on the Home feed (Nov 1), not a tab. A placeholder
 * until notifications are built (M3 and M4).
 */
export default function Notifications() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
      </View>
      <Text variant="display" accessibilityRole="header">
        {t('notifications.title')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('notifications.empty')}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space[4], gap: space[3] },
  header: { flexDirection: 'row' },
});
