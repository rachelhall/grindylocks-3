import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, stroke, Text, useColors } from '@/theme';

// Placeholder until the M2 park directory. It exists to show the fonts,
// tokens and translations are wired up on a real device.
export default function Home() {
  const { t } = useTranslation();
  const c = useColors();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <Text variant="displayXl">{t('common.appName')}</Text>
      <View style={[styles.card, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
        <Text variant="title">{t('home.title')}</Text>
        <Text variant="body" color="textSecondary">
          {t('home.comingSoon')}
        </Text>
        <View style={[styles.chip, { backgroundColor: c.accent }]}>
          <Text variant="label" style={{ color: c.onAccent }}>
            rail
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space[4], gap: space[6] },
  card: { borderWidth: stroke.rule, padding: space[4], gap: space[3] },
  chip: { alignSelf: 'flex-start', paddingHorizontal: space[2], paddingVertical: space[1] },
});
