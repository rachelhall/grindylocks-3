/**
 * The Cancel · TITLE · Save row on Edit page's own screens (Address and pin,
 * Hours; part A PR 7b), matching Edit page's: Save is pink once something
 * changed, and Cancel asks before throwing changes away.
 */
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

export function EditBar({
  title,
  dirty,
  saving,
  onSave,
  onLeave = () => router.back(),
}: {
  title: string;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onLeave?: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const cancel = () => {
    if (!dirty) return onLeave();
    Alert.alert(t('pageEdit.discard'), undefined, [
      { text: t('pageEdit.keepEditing'), style: 'cancel' },
      { text: t('pageEdit.discardButton'), style: 'destructive', onPress: onLeave },
    ]);
  };
  return (
    <View style={styles.head}>
      <Pressable accessibilityRole="button" onPress={cancel} hitSlop={4} style={({ pressed }) => [styles.headButton, pressed && styles.pressed]}>
        <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }}>
          {t('common.cancel')}
        </Text>
      </Pressable>
      <Text variant="title" accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !dirty || saving }}
        disabled={!dirty || saving}
        onPress={onSave}
        style={({ pressed }) => [
          styles.save,
          { backgroundColor: dirty ? c.accent : c.surfaceSunk, borderColor: dirty ? c.onAccent : c.borderSubtle },
          pressed && styles.pressed,
        ]}
      >
        {saving ? (
          <ActivityIndicator color={c.onAccent} accessibilityLabel={t('common.loading')} />
        ) : (
          <Text variant="body" style={{ color: dirty ? c.onAccent : c.textSecondary, fontFamily: fontFamily.sansSemiBold }}>
            {t('pageEdit.save')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], paddingHorizontal: space[3], paddingTop: space[3] },
  headButton: { minWidth: size.tapMin, height: size.tapMin, paddingHorizontal: space[2], justifyContent: 'center' },
  title: { flexShrink: 1, textTransform: 'uppercase', textAlign: 'center' },
  save: { height: size.tapMin, paddingHorizontal: space[4], borderWidth: stroke.rule, justifyContent: 'center' },
});
