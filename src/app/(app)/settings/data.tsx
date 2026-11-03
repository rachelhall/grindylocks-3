import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { SafeAreaView } from '@/components/safe-area';
import { BackButton, Button, Icon } from '@/components/ui';
import { useExportData } from '@/lib/account';
import { useAuth } from '@/lib/auth';
import { space, stroke, Text, useColors } from '@/theme';

const INCLUDED = ['profile', 'social', 'credits', 'reports'] as const;

/**
 * Get a copy of my data (Privacy-Data mockup, M5): what's in it, then
 * "Email my data" (the export-data Edge Function, once a day). After a
 * copy is on its way the button gives way to the "On its way" box.
 */
export default function DataCopy() {
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useAuth();
  const email = session?.user.email ?? '';
  const exportData = useExportData();

  const error = exportData.error?.message;
  const errorText =
    error === 'export_once_a_day'
      ? t('dataCopy.onceADay')
      : error === 'email_not_configured'
        ? t('dataCopy.notSwitchedOn')
        : error === 'network'
          ? t('errors.network')
          : error
            ? t('errors.generic')
            : null;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <BackButton />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="display" accessibilityRole="header" style={styles.title}>
          {t('settings.dataCopy')}
        </Text>
        <Text variant="body">{t('dataCopy.body', { email })}</Text>
        <View style={styles.list}>
          {INCLUDED.map((item) => (
            <View key={item} style={styles.bullet}>
              <Text variant="bodySm" color="textSecondary">
                {'•'}
              </Text>
              <Text variant="bodySm" color="textSecondary" style={styles.flex}>
                {t(`dataCopy.included.${item}`)}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="bodySm" color="textSecondary">
          {t('dataCopy.note')}
        </Text>

        {exportData.isSuccess ? (
          <View
            style={[styles.sent, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
            accessibilityLiveRegion="polite"
          >
            <Icon name="mailSent" color={c.text} />
            <View style={styles.flex}>
              <Text variant="headline">{t('dataCopy.sentTitle')}</Text>
              <Text variant="bodySm" color="textSecondary">
                {t('dataCopy.sentBody', { email })}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <Button label={t('dataCopy.send')} onPress={() => exportData.mutate()} loading={exportData.isPending} />
            {errorText ? (
              <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
                {errorText}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', paddingHorizontal: space[3], paddingTop: space[3] },
  content: { paddingHorizontal: 20, paddingTop: space[2], paddingBottom: space[12], gap: 14 },
  title: { fontSize: 32, lineHeight: 32 },
  list: { gap: 6 },
  bullet: { flexDirection: 'row', gap: space[2], paddingLeft: space[1] },
  sent: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: stroke.rule, padding: 14, marginTop: space[2] },
});
