import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, Text, useColors } from '@/theme';

/** Placeholder until notifications are built (M3 and M4). */
export default function Notifications() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <Text variant="display">{t('notifications.title')}</Text>
      <Text variant="body" color="textSecondary">
        {t('notifications.empty')}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space[4], gap: space[3] },
});
