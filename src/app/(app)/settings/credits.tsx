import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { BackButton } from '@/components/ui';
import { appConfig } from '@/lib/config';
import { space, Text, useColors } from '@/theme';

/** Credits: the OpenStreetMap attribution the park locations need. */
export default function Credits() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
      </View>
      <View style={styles.content}>
        <Text variant="display" accessibilityRole="header">
          {t('settings.credits')}
        </Text>
        <View style={styles.block}>
          <Text variant="headline">{t('credits.osm')}</Text>
          <Text variant="body" color="textSecondary">
            {t('credits.osmBody')}
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(appConfig.osmCopyrightUrl)}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <Text variant="body" color="accentText">
              {t('credits.osmLink')}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', paddingHorizontal: space[3], paddingTop: space[3] },
  content: { padding: space[4], gap: space[6] },
  block: { gap: space[2] },
  link: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  pressed: { opacity: 0.75 },
});
