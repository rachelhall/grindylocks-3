import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/safe-area';

import { Icon } from '@/components/ui';
import { size, space, stroke, Text, useColors } from '@/theme';

/**
 * Messages tab: a "coming soon" page in v1 (Nov 1), so the tab bar is
 * complete. No data and no backend; direct messages are a later feature.
 */
export default function Messages() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <Text variant="display" accessibilityRole="header" style={styles.title}>
        {t('messages.title')}
      </Text>

      <View style={styles.body}>
        <View style={[styles.tile, { backgroundColor: c.accent, borderColor: c.onAccent }]}>
          <Icon name="chat" color={c.onAccent} size={44} />
        </View>
        <Text variant="label" color="textSecondary">
          {t('messages.comingSoon')}
        </Text>
        <Text variant="title" accessibilityRole="header" style={styles.center}>
          {t('messages.heading')}
        </Text>
        <Text variant="body" color="textSecondary" style={styles.center}>
          {t('messages.body')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('messages.findSkaters')}
          onPress={() => router.navigate('/search')}
          style={({ pressed }) => [styles.button, { backgroundColor: c.text }, pressed && styles.pressed]}
        >
          <Icon name="findPeople" color={c.surface} size={20} />
          <Text variant="headline" style={{ color: c.surface, fontSize: 16 }}>
            {t('messages.findSkaters')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { paddingHorizontal: space[4], paddingTop: space[4] },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[8],
  },
  tile: {
    width: 88,
    height: 88,
    borderWidth: stroke.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  button: {
    marginTop: space[2],
    minHeight: size.tapMin,
    paddingHorizontal: space[6],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  pressed: { opacity: 0.75 },
});
