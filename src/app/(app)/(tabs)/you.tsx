import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { space, Text, useColors } from '@/theme';

/**
 * Placeholder for your profile (M3): who you're signed in as, signing out,
 * and credits, including the OpenStreetMap credit the park pins need.
 */
export default function You() {
  const { t } = useTranslation();
  const c = useColors();
  const { profile, signOut } = useAuth();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <Text variant="display">{t('you.title')}</Text>
      <Text variant="body" color="textSecondary">
        {t('home.signedInAs', { username: profile?.username ?? '' })}
      </Text>
      <Button label={t('common.signOut')} variant="secondary" onPress={signOut} />

      <View style={styles.credits}>
        <Text variant="label" color="textSecondary">
          {t('you.credits')}
        </Text>
        <Text variant="bodySm" color="textSecondary">
          {t('you.osm')}
        </Text>
        <Text
          variant="bodySm"
          color="accentText"
          accessibilityRole="link"
          onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}
        >
          {t('you.osmLink')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space[4], gap: space[4] },
  credits: { marginTop: 'auto', gap: space[1], paddingBottom: space[4] },
});
