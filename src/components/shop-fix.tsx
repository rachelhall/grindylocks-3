/**
 * Suggest a fix on an unofficial shop (the Shop-Fix mockup, Brand accounts
 * (v2) · shops & map row), from the page's ⋯ menu. Built with the web admin
 * for brands (part A, PR 6), since it needs the city admin's queue: the
 * shop's city admin checks it before anything changes (Rachel as backup), and
 * the person hears when it's live, like a park fix.
 */
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Sheet, SheetHead } from '@/components/pages';
import { useExplainRestriction } from '@/components/safety';
import { Chip } from '@/components/tagging';
import { Button, Icon, TextField } from '@/components/ui';
import { MAX_PAGE_FIX, type Page, PAGE_FIX_FIELDS, type PageFixField, useFilePageFix } from '@/lib/pages';
import { Sentry } from '@/lib/sentry';
import { fontFamily, space, Text, useColors } from '@/theme';

type Visit = 'storefront' | 'by_appointment' | 'online_only';
const VISITS: Visit[] = ['storefront', 'by_appointment', 'online_only'];

export function useShopFixSheet(): { sheet: ReactNode; open: (page: Page) => void } {
  const [page, setPage] = useState<Page | null>(null);
  const close = useCallback(() => setPage(null), []);
  const open = useCallback((next: Page) => setPage(next), []);
  const sheet = (
    <Sheet visible={page !== null} onClose={close}>
      {page ? <ShopFixContent key={page.id} page={page} onClose={close} /> : null}
    </Sheet>
  );
  return { sheet, open };
}

function ShopFixContent({ page, onClose }: { page: Page; onClose: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const file = useFilePageFix();
  const explainRestriction = useExplainRestriction();
  const [field, setField] = useState<PageFixField | null>(null);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  const listed = (f: PageFixField): string | null => {
    switch (f) {
      case 'location_type':
        return page.locationType ? t(`shopFix.listedType.${page.locationType}`) : null;
      case 'location':
        return page.address;
      case 'website':
        return page.website;
      case 'brands_carried':
        return page.brandsCarried.length ? page.brandsCarried.map((b) => b.displayName).join(', ') : null;
      case 'hours':
        return page.hours.length ? t('shopFix.listedHours') : null;
      case 'closed':
        return t('shopFix.listedOpen');
      default:
        return null;
    }
  };

  const pick = (f: PageFixField) => {
    setField(f);
    setValue('');
    setVisit(null);
  };

  const fixValue = field === 'location_type' ? (visit ?? '') : value;
  const ready = field !== null && (field === 'closed' || fixValue.trim().length > 0);

  const send = () => {
    if (!field || !ready) return;
    file.mutate(
      { pageId: page.id, field, value: fixValue, note },
      {
        onSuccess: () => setSent(true),
        onError: async (err) => {
          if (await explainRestriction(err)) return;
          Sentry.captureException(err);
          Alert.alert(t('errors.generic'), t('errors.network'));
        },
      },
    );
  };

  if (sent) {
    return (
      <View style={styles.body}>
        <View style={styles.sent}>
          <Icon name="checkCircle" color={c.statusOpen} size={40} />
          <Text variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
            {t('shopFix.sentTitle')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('shopFix.sentBody')}
          </Text>
        </View>
        <Button label={t('report.done')} palette={{ fill: c.accent, text: c.onAccent, border: c.accent }} onPress={onClose} />
      </View>
    );
  }

  const now = field ? listed(field) : null;

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
      <SheetHead label={t('shopFix.label', { name: page.displayName.toUpperCase() })} title={t('shopFix.title')} onClose={onClose} />

      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('shopFix.title')}>
        {PAGE_FIX_FIELDS.map((f) => (
          <Chip key={f} label={t(`shopFix.field.${f}`)} picked={field === f} onPress={() => pick(f)} />
        ))}
      </View>

      {field && field !== 'other' && now ? (
        <View style={[styles.listed, { backgroundColor: c.surfaceRaised }]}>
          <Text variant="label" color="textSecondary">
            {t('shopFix.listedNow')}
          </Text>
          <Text variant="bodySm" style={styles.strong}>
            {now}
          </Text>
        </View>
      ) : null}

      {field === 'location_type' ? (
        <View style={styles.group}>
          <Text variant="bodySm" style={styles.strong}>
            {t('shopFix.shouldBe')}
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('shopFix.shouldBe')}>
            {VISITS.map((v) => (
              <Chip key={v} label={t(`shop.type.${v}`)} picked={visit === v} onPress={() => setVisit(v)} />
            ))}
          </View>
        </View>
      ) : field && field !== 'closed' ? (
        <TextField
          label={field === 'other' ? t('shopFix.whatsWrong') : t('shopFix.shouldBe')}
          placeholder={t(`shopFix.placeholder.${field}`)}
          value={value}
          onChangeText={setValue}
          maxLength={MAX_PAGE_FIX}
          multiline={field === 'hours' || field === 'brands_carried' || field === 'other'}
          textAlignVertical="top"
          autoCapitalize={field === 'website' ? 'none' : 'sentences'}
          keyboardType={field === 'website' ? 'url' : 'default'}
        />
      ) : null}

      {field ? (
        <TextField
          label={t('shopFix.note')}
          labelNote={t('common.optional')}
          value={note}
          onChangeText={setNote}
          maxLength={MAX_PAGE_FIX}
          multiline
          textAlignVertical="top"
        />
      ) : null}

      <Text variant="bodySm" color="textSecondary">
        {t('shopFix.who')}
      </Text>
      <Button
        label={t('shopFix.send')}
        palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        onPress={send}
        disabled={!ready}
        loading={file.isPending}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: space[3], gap: space[4] },
  sent: { gap: space[2], paddingTop: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  group: { gap: space[2] },
  listed: { padding: space[3], gap: space[1] },
  strong: { fontFamily: fontFamily.sansSemiBold },
});
