/**
 * The Products tab (part A, PR 4), per the Brand accounts (v2) mockups:
 * Brand-Products, Brand-Products-Past, Brand-Products-Bones,
 * Brand-Product-Sheet and Brand-Suggest.
 *
 * - Grouped by part type, then family (a family header only for two or more
 *   models), with pro models, collabs and special editions under their model
 *   and the year on the right where known.
 * - Discontinued gear sits behind Show past gear; turned on, past rows appear
 *   in place with a dashed outline and a PAST tag. Retired brands show
 *   everything, with no toggle.
 * - A group gets a discipline label only when it isn't for every discipline
 *   the brand covers (WHEELS · SKATEBOARD on Bones).
 * - Collabs another brand sells with this page sit in their own group.
 * - Tapping a product opens its sheet; Suggest a change goes to Rachel's
 *   Product suggestions queue. Read-only for everyone, teams included.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Sheet, SheetHead } from '@/components/pages';
import { Chip } from '@/components/tagging';
import { Button, Icon, TextField, Toggle } from '@/components/ui';
import {
  buildCatalog,
  type CatalogEntry,
  type CatalogUnit,
  entryLabel,
  type PartType,
  type SuggestionKind,
  useProduct,
  useSuggestProduct,
} from '@/lib/catalog';
import { Sentry } from '@/lib/sentry';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

type CatalogPage = { id: string; displayName: string };

/**
 * A page's products. `entries` comes from usePageCatalog, which the page
 * screen also uses to decide whether to show the Products tab at all.
 */
export function ProductsList({ page, entries, archive }: { page: CatalogPage; entries: CatalogEntry[]; archive: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const [showPast, setShowPast] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<{ product: CatalogEntry | null } | null>(null);
  const view = useMemo(() => buildCatalog(entries, page.id, { showPast, archive }), [entries, page.id, showPast, archive]);

  return (
    <View>
      {view.pastCount > 0 ? (
        <View style={styles.pastRow}>
          <Text variant="bodySm" color="textSecondary" style={styles.flex} accessibilityLiveRegion="polite">
            {showPast ? t('catalog.showingPast', { count: view.pastCount }) : t('catalog.pastHidden', { count: view.hiddenCount })}
          </Text>
          <Pressable
            onPress={() => setShowPast(!showPast)}
            style={styles.toggleLabel}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
              {t('catalog.showPast')}
            </Text>
          </Pressable>
          <Toggle value={showPast} onChange={setShowPast} label={t('catalog.showPast')} fg={c.text} />
        </View>
      ) : null}

      <View style={styles.list}>
        {view.groups.map((g) => (
          <View key={g.partType} style={styles.group}>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.groupHead}>
              {[t(`catalog.partTypes.${g.partType}`), g.disciplines ? g.disciplines.map((d) => t(`disciplines.${d}`)).join(', ') : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {g.blocks.map((b, i) => (
              <View
                key={b.family ?? `loose-${i}`}
                // Loose models after a family get a gap, so they don't read as part of it.
                style={[styles.block, !b.family && i > 0 && styles.afterFamily]}
              >
                {b.family ? (
                  <Text variant="headline" style={styles.family}>
                    {b.family}
                  </Text>
                ) : null}
                {b.units.map((u) => (
                  <Unit key={unitKey(u)} unit={u} archive={archive} onOpen={setSheetId} />
                ))}
              </View>
            ))}
          </View>
        ))}

        {view.collabs.length > 0 ? (
          <View style={styles.group}>
            <Text variant="label" color="textSecondary" accessibilityRole="header" style={styles.groupHead}>
              {t('catalog.collabs')}
            </Text>
            <Text variant="bodySm" color="textSecondary">
              {t('catalog.collabsNote', { name: page.displayName })}
            </Text>
            {view.collabs.map((e) => (
              <ProductRow
                key={e.id}
                title={e.name}
                subtitle={t('catalog.partBy', { part: t(`catalog.partTypes.${e.partType}`), brand: e.pageName })}
                past={!archive && e.status === 'discontinued'}
                onPress={() => setSheetId(e.id)}
              />
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { borderColor: c.borderSubtle }]}>
        <Text variant="bodySm" color="textSecondary">
          {t('catalog.missing')}{' '}
        </Text>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => setSuggest({ product: null })}>
          <Text variant="bodySm" style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}>
            {t('catalog.suggestChange')}
          </Text>
        </Pressable>
      </View>

      <Sheet visible={sheetId !== null} onClose={() => setSheetId(null)}>
        {sheetId ? (
          <ProductSheet
            id={sheetId}
            onOpen={setSheetId}
            onClose={() => setSheetId(null)}
            onSuggest={(product) => {
              setSheetId(null);
              setSuggest({ product });
            }}
          />
        ) : null}
      </Sheet>

      <Sheet visible={suggest !== null} onClose={() => setSuggest(null)}>
        {suggest ? (
          <SuggestContent
            page={suggest.product && suggest.product.pageId !== page.id && suggest.product.partnerPageId !== page.id
              ? { id: suggest.product.pageId, displayName: suggest.product.pageName }
              : page}
            partTypes={view.partTypes}
            entries={entries}
            initial={suggest.product}
            onClose={() => setSuggest(null)}
          />
        ) : null}
      </Sheet>
    </View>
  );
}

const unitKey = (u: CatalogUnit) => (u.kind === 'heading' ? `h-${u.name}-${u.sort}` : u.entry.id);

function useTag() {
  const { t } = useTranslation();
  return (e: CatalogEntry) =>
    [t(`catalog.entryTypes.${e.entryType}`), e.firstYear].filter(Boolean).join(' · ');
}

function Unit({ unit, archive, onOpen }: { unit: CatalogUnit; archive: boolean; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const tag = useTag();
  const past = (e: CatalogEntry) => !archive && e.status === 'discontinued';
  const children = unit.kind === 'single' ? [] : unit.children;
  return (
    <>
      {unit.kind === 'model' ? (
        <ProductRow title={unit.entry.name} year={unit.entry.firstYear} past={past(unit.entry)} onPress={() => onOpen(unit.entry.id)} />
      ) : unit.kind === 'heading' ? (
        <View style={styles.heading}>
          <Text variant="body" style={{ fontFamily: fontFamily.sansSemiBold }} accessibilityRole="header">
            {unit.name}
          </Text>
        </View>
      ) : (
        <ProductRow
          title={unit.entry.name}
          subtitle={entryLabel(unit.entry) !== unit.entry.name ? entryLabel(unit.entry) : null}
          tag={tag(unit.entry)}
          past={past(unit.entry)}
          onPress={() => onOpen(unit.entry.id)}
        />
      )}
      {children.map((e) => (
        <ProductRow
          key={e.id}
          sub
          title={entryLabel(e)}
          tag={tag(e)}
          past={past(e)}
          accessibilityHint={t('catalog.builtOn', { name: e.name })}
          onPress={() => onOpen(e.id)}
        />
      ))}
    </>
  );
}

function ProductRow({
  title,
  subtitle,
  year,
  tag,
  past,
  sub,
  accessibilityHint,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  year?: string | null;
  tag?: string;
  past: boolean;
  sub?: boolean;
  accessibilityHint?: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const right = tag || year;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, tag ?? year, past ? t('catalog.past') : null].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        sub ? styles.subRow : styles.row,
        past
          ? { backgroundColor: 'transparent', borderColor: c.textMuted, borderWidth: stroke.rule, borderStyle: 'dashed' }
          : { backgroundColor: c.surfaceRaised },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowMain}>
        <Text variant="body" style={sub ? styles.subTitle : styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodySm" color="textSecondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowEnd}>
        {tag ? (
          <Text variant="label" color="textSecondary">
            {tag}
          </Text>
        ) : year ? (
          <Text variant="bodySm" color="textSecondary">
            {year}
          </Text>
        ) : null}
        {past ? <PastTag /> : null}
        {!right && !past ? <Icon name="chevron" color={c.textSecondary} size={20} /> : null}
      </View>
    </Pressable>
  );
}

function PastTag() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={[styles.pastTag, { borderColor: c.textSecondary }]}>
      <Text variant="label" color="textSecondary" style={styles.pastTagText}>
        {t('catalog.past')}
      </Text>
    </View>
  );
}

/* The product sheet ---------------------------------------------------------------------------- */

function ProductSheet({
  id,
  onOpen,
  onClose,
  onSuggest,
}: {
  id: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  onSuggest: (product: CatalogEntry) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { data, isError, refetch } = useProduct(id);

  if (data === undefined && !isError) {
    return <ActivityIndicator color={c.text} style={styles.sheetLoading} accessibilityLabel={t('common.loading')} />;
  }
  if (!data) {
    return (
      <View style={styles.sheetBody}>
        <SheetHead title={t('catalog.title')} onClose={onClose} />
        <Text variant="body" color="textSecondary">
          {isError ? t('errors.network') : t('catalog.gone')}
        </Text>
        {isError ? <Button label={t('common.retry')} onPress={() => void refetch()} /> : null}
      </View>
    );
  }

  const e = data.entry;
  const built = e.entryType !== 'model';
  const status = e.status === 'current' ? t('catalog.stillMade') : e.status === 'discontinued' ? t('catalog.noLongerMade') : null;
  const pros = data.children.filter((x) => x.entryType === 'pro').map(entryLabel);
  const others = data.children.filter((x) => x.entryType !== 'pro').map(entryLabel);
  const goToPage = (handle: string) => {
    onClose();
    router.push(`/page/${handle}`);
  };

  return (
    <ScrollView contentContainerStyle={styles.sheetBody} bounces={false}>
      <SheetHead label={`${e.pageName} · ${t(`catalog.partTypes.${e.partType}`)}`} title={e.name} onClose={onClose} />
      {built ? (
        <Text variant="headline" style={styles.builtLine}>
          {[entryLabel(e), t(`catalog.entryTypeNames.${e.entryType}`)].join(' · ')}
        </Text>
      ) : null}

      <View>
        <View style={[styles.lines, { borderColor: c.borderSubtle }]}>
          {e.proRider ? <Line k={t('catalog.proRider')} v={e.proRider} /> : null}
          {e.partnerHandle && e.partnerName ? (
            <Line k={t('catalog.with')} v={e.partnerName} onPress={() => goToPage(e.partnerHandle!)} />
          ) : null}
          {e.edition && e.entryType === 'special_edition' ? <Line k={t('catalog.edition')} v={e.edition} /> : null}
          {e.firstYear ? <Line k={t('catalog.firstOut')} v={e.firstYear} /> : null}
          {status ? <Line k={t('catalog.status')} v={status} /> : null}
          <Line k={t('catalog.for')} v={e.disciplines.map((d) => t(`disciplines.${d}`)).join(', ')} />
        </View>
      </View>

      {data.stock.length > 0 || e.includesFrame ? (
        <View style={styles.sheetSection}>
          <Text variant="label" color="textSecondary" accessibilityRole="header">
            {t('catalog.stockSetup')}
          </Text>
          <View style={[styles.lines, { borderColor: c.borderSubtle }]}>
            {e.includesFrame ? <Line k={t('catalog.partTypes.frame')} v={t('catalog.partOfBoot')} /> : null}
            {data.stock.map((s) => (
              <Line
                key={s.partType}
                k={t(`catalog.partTypes.${s.partType}`)}
                v={`${s.pageName} ${s.name}`}
                onPress={() => onOpen(s.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {pros.length + others.length > 0 ? (
        <View style={styles.sheetSection}>
          <Text variant="label" color="textSecondary" accessibilityRole="header">
            {pros.length && others.length ? t('catalog.prosAndCollabs') : pros.length ? t('catalog.pros') : t('catalog.collabsAndEditions')}
          </Text>
          <Text variant="body">{[pros.join(', '), others.join(', ')].filter(Boolean).join(' · ')}</Text>
        </View>
      ) : null}

      <Button label={t('catalog.suggestChange')} variant="secondary" icon="edit" onPress={() => onSuggest(e)} />
    </ScrollView>
  );
}

function Line({ k, v, onPress }: { k: string; v: string; onPress?: () => void }) {
  const c = useColors();
  const content = (
    <>
      <Text variant="body" color="textSecondary">
        {k}
      </Text>
      <Text variant="body" style={[styles.lineValue, onPress && { color: c.accentText }]}>
        {v}
      </Text>
    </>
  );
  if (!onPress) {
    return <View style={[styles.line, { borderColor: c.borderSubtle }]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${k}, ${v}`}
      onPress={onPress}
      style={({ pressed }) => [styles.line, { borderColor: c.borderSubtle }, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

/* Suggest a change ----------------------------------------------------------------------------- */

const KINDS: SuggestionKind[] = ['missing_model', 'wrong_name', 'wrong_year', 'no_longer_made', 'stock_parts', 'something_else'];
const NEEDS_PRODUCT: SuggestionKind[] = ['wrong_name', 'wrong_year', 'no_longer_made', 'stock_parts'];
const MAX_VALUE = 200;
const MAX_NOTE = 300;

function SuggestContent({
  page,
  partTypes,
  entries,
  initial,
  onClose,
}: {
  page: CatalogPage;
  partTypes: PartType[];
  entries: CatalogEntry[];
  initial: CatalogEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const suggest = useSuggestProduct();
  const [kind, setKind] = useState<SuggestionKind>(initial ? 'wrong_name' : 'missing_model');
  const [product, setProduct] = useState<CatalogEntry | null>(initial);
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState('');
  const [partType, setPartType] = useState<PartType | null>(partTypes[0] ?? null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  const needsProduct = NEEDS_PRODUCT.includes(kind);
  const needsValue = kind !== 'no_longer_made';
  const canSend = (!needsProduct || product !== null) && (!needsValue || value.trim().length > 0);

  const send = () =>
    suggest.mutate(
      {
        pageId: page.id,
        kind,
        productId: kind === 'missing_model' ? null : product?.id ?? null,
        value: needsValue ? value : undefined,
        partType: kind === 'missing_model' ? partType : null,
        note,
      },
      {
        onSuccess: () => setSent(true),
        onError: (err) => {
          if ((err as { message?: string }).message === 'too_many_suggestions') {
            Alert.alert(t('catalog.suggest.tooMany'));
            return;
          }
          Sentry.captureException(err);
          Alert.alert(t('errors.generic'), t('errors.network'));
        },
      },
    );

  if (sent) {
    return (
      <View style={styles.sheetBody}>
        <View style={styles.sent}>
          <Icon name="checkCircle" color={c.statusOpen} size={40} />
          <Text variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
            {t('catalog.suggest.sentTitle')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('catalog.suggest.sentBody')}
          </Text>
        </View>
        <Button label={t('report.done')} palette={{ fill: c.accent, text: c.onAccent, border: c.accent }} onPress={onClose} />
      </View>
    );
  }

  const productName = (e: CatalogEntry) => (e.entryType === 'model' ? e.name : `${e.name} · ${entryLabel(e)}`);
  const pickable = entries.filter((e) => e.pageId === page.id || e.partnerPageId === page.id);

  return (
    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" bounces={false}>
      <SheetHead label={t('catalog.suggest.label', { name: page.displayName })} title={t('catalog.suggest.title')} onClose={onClose} />

      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('catalog.suggest.kind')}>
        {KINDS.map((k) => (
          <Chip key={k} label={t(`catalog.suggest.kinds.${k}`)} picked={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>

      {needsProduct || (kind === 'something_else' && product) ? (
        <View style={styles.field}>
          <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {t('catalog.suggest.which')}
          </Text>
          {product && !picking ? (
            <View style={[styles.picked, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}>
              <Text variant="body" style={[styles.flex, { fontFamily: fontFamily.sansSemiBold }]}>
                {productName(product)}
              </Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setPicking(true)} style={styles.change}>
                <Text variant="bodySm" style={{ color: c.accentText, fontFamily: fontFamily.sansSemiBold }}>
                  {t('catalog.suggest.change')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView style={[styles.pickList, { borderColor: c.border }]} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {pickable.map((e) => (
                <Pressable
                  key={e.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: product?.id === e.id }}
                  onPress={() => {
                    setProduct(e);
                    setPicking(false);
                  }}
                  style={({ pressed }) => [styles.pickRow, { borderColor: c.borderSubtle }, pressed && styles.pressed]}
                >
                  <Text variant="bodySm" style={styles.flex}>
                    {productName(e)}
                  </Text>
                  {product?.id === e.id ? <Icon name="check" color={c.text} size={18} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      {needsValue ? (
        <TextField
          label={t(`catalog.suggest.valueLabel.${kind}`)}
          placeholder={kind === 'missing_model' ? t('catalog.suggest.modelPlaceholder') : kind === 'wrong_year' ? t('catalog.suggest.yearPlaceholder') : undefined}
          value={value}
          onChangeText={setValue}
          maxLength={MAX_VALUE}
          autoCapitalize={kind === 'wrong_year' ? 'none' : 'sentences'}
          multiline={kind === 'stock_parts' || kind === 'something_else'}
        />
      ) : null}

      {kind === 'missing_model' && partTypes.length > 0 ? (
        <View style={styles.field}>
          <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
            {t('catalog.suggest.part')}
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {partTypes.map((p) => (
              <Chip key={p} label={t(`catalog.partTypes.${p}`)} picked={partType === p} onPress={() => setPartType(p)} />
            ))}
            <Chip label={t('catalog.suggest.otherPart')} picked={partType === null} onPress={() => setPartType(null)} />
          </View>
        </View>
      ) : null}

      <TextField
        label={t('catalog.suggest.where')}
        labelNote={t('common.optional')}
        placeholder={t('catalog.suggest.wherePlaceholder')}
        value={note}
        onChangeText={setNote}
        maxLength={MAX_NOTE}
        autoCapitalize="none"
      />

      <Text variant="bodySm" color="textSecondary">
        {t('catalog.suggest.note')}
      </Text>
      <Button
        label={t('catalog.suggest.send')}
        palette={{ fill: c.accent, text: c.onAccent, border: c.accent }}
        onPress={send}
        disabled={!canSend}
        loading={suggest.isPending}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: size.tapMin },
  toggleLabel: { minHeight: size.tapMin, justifyContent: 'center' },
  list: { gap: space[1] },
  group: { gap: 6 },
  groupHead: { paddingTop: 14, paddingBottom: 2 },
  block: { gap: 6 },
  family: { fontSize: 15, paddingTop: 6 },
  afterFamily: { paddingTop: space[3] },
  row: {
    minHeight: 52,
    paddingHorizontal: space[3],
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  subRow: {
    marginLeft: 20,
    minHeight: size.tapMin,
    paddingHorizontal: space[3],
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  heading: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[1] },
  rowMain: { flex: 1, minWidth: 0, gap: 1 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  title: { fontFamily: fontFamily.sansSemiBold },
  subTitle: { fontSize: 15 },
  pastTag: { borderWidth: stroke.hairline, paddingHorizontal: 5, paddingVertical: 1 },
  pastTagText: { fontSize: 11, lineHeight: 14 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: space[6],
    paddingTop: 14,
    borderTopWidth: stroke.hairline,
  },
  sheetLoading: { marginVertical: space[12] },
  sheetBody: { paddingHorizontal: 20, paddingTop: space[3], gap: space[4] },
  builtLine: { marginTop: -space[2] },
  sheetSection: { gap: space[2] },
  lines: { borderTopWidth: stroke.hairline },
  line: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    borderBottomWidth: stroke.hairline,
  },
  lineValue: { fontFamily: fontFamily.sansSemiBold, flexShrink: 1, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  field: { gap: 6 },
  picked: { minHeight: 52, borderWidth: stroke.rule, flexDirection: 'row', alignItems: 'center', paddingLeft: space[3], gap: space[2] },
  change: { minHeight: size.tapMin, justifyContent: 'center', paddingHorizontal: space[3] },
  pickList: { maxHeight: 220, borderWidth: stroke.rule },
  pickRow: {
    minHeight: size.tapMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    borderBottomWidth: stroke.hairline,
  },
  sent: { gap: space[2], paddingTop: space[2] },
});
