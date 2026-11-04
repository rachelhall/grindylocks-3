import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PageLogoForm } from '@/components/page-logo';
import { SafeAreaView } from '@/components/safe-area';
import { BackButton, Button } from '@/components/ui';
import { usePage } from '@/lib/pages';
import { space, Text, useColors } from '@/theme';

/**
 * Add a page's logo, opened from "Your claim was approved" and from the
 * owner's card on the page (Edit page takes over in PR 7). Saving makes the
 * page OFFICIAL.
 */
export default function PageLogoScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { data: page, isError, refetch } = usePage(handle);

  const leave = () =>
    router.canGoBack() ? router.back() : router.replace({ pathname: '/page/[handle]', params: { handle } });

  if (!page) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
        <View style={styles.top}>
          <BackButton />
        </View>
        {isError ? (
          <View style={styles.block}>
            <Text variant="body" color="textSecondary">
              {t('errors.network')}
            </Text>
            <Button label={t('common.retry')} onPress={() => void refetch()} />
          </View>
        ) : (
          <ActivityIndicator color={c.text} accessibilityLabel={t('common.loading')} style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <PageLogoForm
      page={{ id: page.id, displayName: page.displayName, roles: page.roles, city: page.city }}
      header={<BackButton />}
      onDone={leave}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: space[4], paddingVertical: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3] },
  loading: { marginTop: space[12] },
});
