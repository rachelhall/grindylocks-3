import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PageTile, usePageLine } from '@/components/pages';
import { useTeamErrorAlert } from '@/components/page-team';
import { SafeAreaView } from '@/components/safe-area';
import { BackButton, Button, Icon, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useSetBrandsCarried } from '@/lib/page-team';
import { type CarriedBrand, type Page, searchPages, usePage } from '@/lib/pages';
import { fresh, keys } from '@/lib/query';
import { space, stroke, Text, useColors } from '@/theme';

const MAX_BRANDS = 60;

/**
 * Brands we carry (Edit page, PR 7a; managers and the owner): the brands on
 * the shop's page, with a search to add more from the brands on Grindylocks.
 * Brands that aren't listed yet go through "Suggest it" in Search.
 */
export default function PageBrandsScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { data: page, isError, refetch } = usePage(handle);
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
  return <BrandsForm page={page} />;
}

function BrandsForm({ page }: { page: Page }) {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const line = usePageLine();
  const alertError = useTeamErrorAlert();
  const save = useSetBrandsCarried(session?.user.id);
  const [brands, setBrands] = useState<CarriedBrand[]>(page.brandsCarried);
  const [q, setQ] = useState('');
  const query = q.trim().replace(/^@+/, '');
  const results = useQuery({
    queryKey: keys.pageSearch(query.toLowerCase(), false),
    queryFn: () => searchPages(query, false, 10),
    enabled: query.length >= 2,
    staleTime: fresh.search,
  });
  const picked = new Set(brands.map((b) => b.id));
  const matches = (results.data ?? []).filter((p) => p.roles.includes('brand') && p.id !== page.id && !picked.has(p.id) && p.state !== 'out_of_business');
  const dirty = brands.map((b) => b.id).join() !== page.brandsCarried.map((b) => b.id).join();

  const leave = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/page-edit/[handle]', params: { handle: page.handle } }));
  const back = () => {
    if (!dirty) return leave();
    Alert.alert(t('pageEdit.discard'), undefined, [
      { text: t('pageEdit.keepEditing'), style: 'cancel' },
      { text: t('pageEdit.discardButton'), style: 'destructive', onPress: leave },
    ]);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.top}>
        <BackButton onPress={back} />
        <View style={styles.flex}>
          <Text variant="label" color="textSecondary">
            {page.displayName}
          </Text>
          <Text variant="title" accessibilityRole="header">
            {t('shop.brandsWeCarry')}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label={t('pageEdit.brands.find')}
          icon="search"
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t('pageEdit.brands.placeholder')}
        />
        {matches.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={t('pageEdit.brands.add', { name: p.displayName })}
            disabled={brands.length >= MAX_BRANDS}
            onPress={() => {
              setBrands((all) => [...all, { id: p.id, handle: p.handle, displayName: p.displayName, state: p.state, logoPath: p.logoPath }]);
              setQ('');
            }}
            style={({ pressed }) => [styles.row, { backgroundColor: c.surfaceRaised }, pressed && styles.pressed]}
          >
            <PageTile page={p} size={36} />
            <View style={styles.flex}>
              <Text variant="headline" numberOfLines={1}>
                {p.displayName}
              </Text>
              <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
                {line(p)}
              </Text>
            </View>
            <Icon name="add" color={c.text} size={22} />
          </Pressable>
        ))}

        <Text variant="label" color="textSecondary" accessibilityRole="header">
          {t('pageEdit.brands.count', { count: brands.length })}
        </Text>
        {brands.length === 0 ? (
          <Text variant="bodySm" color="textSecondary">
            {t('pageEdit.brands.none')}
          </Text>
        ) : (
          brands.map((b) => (
            <View key={b.id} style={[styles.row, { borderColor: c.borderSubtle, borderWidth: stroke.rule }]}>
              <PageTile page={b} size={36} />
              <Text variant="headline" numberOfLines={1} style={styles.flex}>
                {b.displayName}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('pageEdit.brands.remove', { name: b.displayName })}
                onPress={() => setBrands((all) => all.filter((x) => x.id !== b.id))}
                hitSlop={4}
                style={({ pressed }) => [styles.square, pressed && styles.pressed]}
              >
                <Icon name="close" color={c.text} size={20} />
              </Pressable>
            </View>
          ))
        )}
        <Button
          label={t('pageEdit.save')}
          disabled={!dirty}
          loading={save.isPending}
          onPress={() =>
            save.mutate({ pageId: page.id, brandIds: brands.map((b) => b.id) }, { onSuccess: leave, onError: (err) => void alertError(err) })
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingTop: space[2] },
  block: { paddingHorizontal: space[4], gap: space[3], paddingTop: space[4] },
  loading: { marginTop: space[12] },
  content: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[12], gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2], minHeight: 56 },
  square: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
