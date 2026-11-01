import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/profile';
import { BackButton, Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useBlock, useBlockedAccounts } from '@/lib/social';
import { space, stroke, Text, useColors } from '@/theme';

/**
 * Settings › Blocked accounts. Unblocking doesn't bring back a follow that
 * the block ended; either of you can follow again.
 */
export default function BlockedAccounts() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { data, isPending, isError, refetch } = useBlockedAccounts(userId);
  const block = useBlock(userId);

  function unblock(id: string, username: string) {
    Alert.alert(t('block.unblockTitle', { username }), t('block.unblockBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('block.unblock'),
        onPress: () =>
          block.mutate({ personId: id, block: false }, { onError: () => Alert.alert(t('errors.generic'), t('errors.network')) }),
      },
    ]);
  }

  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
        <Text variant="display" accessibilityRole="header" style={styles.title}>
          {t('block.listTitle')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="bodySm" color="textSecondary" style={styles.intro}>
          {t('block.listBody')}
        </Text>
        {isPending ? (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} />
        ) : isError && !data ? (
          <View style={styles.intro}>
            <Text variant="body" color="statusClosed">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} variant="secondary" onPress={() => void refetch()} />
          </View>
        ) : data.length === 0 ? (
          <Text variant="body" color="textSecondary" style={styles.intro}>
            {t('block.none')}
          </Text>
        ) : (
          data.map((person, i) => {
            const name = person.username || t('common.deletedUser');
            return (
              <View
                key={person.id}
                style={[
                  styles.row,
                  { backgroundColor: c.surfaceRaised, borderColor: c.borderSubtle, borderTopWidth: i === 0 ? stroke.hairline : 0 },
                ]}
              >
                <Avatar path={person.avatar_path} username={name} size={40} />
                <View style={styles.rowText}>
                  <Text variant="body" numberOfLines={1}>
                    {name}
                  </Text>
                  <Text variant="bodySm" color="textSecondary">
                    {t('block.since', { date: date(person.blocked_at) })}
                  </Text>
                </View>
                <Button
                  label={t('block.unblock')}
                  variant="secondary"
                  onPress={() => unblock(person.id, name)}
                  style={styles.button}
                />
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingTop: space[3] },
  title: { fontSize: 28, lineHeight: 30 },
  content: { paddingBottom: space[12] },
  intro: { paddingHorizontal: 20, paddingVertical: space[4], gap: space[3] },
  loading: { marginTop: space[8] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: stroke.hairline,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  button: { minHeight: 48, paddingHorizontal: space[3] },
});
