import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AnnounceCard } from '@/components/home-picker';
import { FormScreen } from '@/components/screen';
import { Button } from '@/components/ui';
import { announceArrival } from '@/lib/announcements';
import { useAuth } from '@/lib/auth';
import { useMetro } from '@/lib/parks';
import { space, Text, useColors } from '@/theme';

/**
 * Shown after saving a new home city in Edit profile: the same "say hi"
 * announcement as onboarding, on by default. Nothing is sent if it's
 * switched off. Old posts keep the metro area they were posted in.
 */
export default function SayHi() {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const { metroId, parkId } = useLocalSearchParams<{ metroId: string; parkId?: string }>();
  const { data: metro } = useMetro(metroId);
  const [announce, setAnnounce] = useState(true);
  const [sending, setSending] = useState(false);

  async function done() {
    if (announce && session && metroId) {
      setSending(true);
      await announceArrival(session.user.id, metroId, parkId || null);
    }
    router.back();
  }

  return (
    <FormScreen footer={<Button label={t('editProfile.done')} onPress={done} loading={sending} />}>
      {metro ? (
        <>
          <View style={styles.intro}>
            <Text variant="display" accessibilityRole="header">
              {t('sayHi.title', { city: metro.name })}
            </Text>
            <Text variant="body" color="textSecondary">
              {t('sayHi.body')}
            </Text>
          </View>
          <AnnounceCard city={metro.name} value={announce} onChange={setAnnounce} />
        </>
      ) : (
        <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} />
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space[3] },
});
