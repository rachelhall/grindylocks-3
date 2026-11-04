/**
 * The map's filter button, filter sheet and edge markers (v2, Nov 2), laid
 * out from the Map (v2) row of the Mockups canvas: "Map · edge markers",
 * "Filter sheet" and "Map · 3 filters on". The sheet's On the map section
 * and its park-only labels come from Map-Filters-Shops (part A, PR 3).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Caption, Chip, Sheet } from '@/components/tagging';
import { Button, CheckBox, Icon } from '@/components/ui';
import {
  FILTER_DISCIPLINES,
  filterCount,
  type MapFilters,
  NO_FILTERS,
  SETTING_CHOICES,
  type SettingChoice,
} from '@/lib/map-filters';
import type { Edge } from '@/lib/map-edge';
import type { Discipline } from '@/lib/parks';
import { fontFamily, size, space, stroke, Text, useColors } from '@/theme';

/* Filter button ----------------------------------------------------------------- */

/** The square button beside the search bar; a pink count badge while filters are on. */
export function FilterButton({ filters, onPress }: { filters: MapFilters; onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const count = filterCount(filters);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? t('map.filters.buttonOn', { count }) : t('map.filters.button')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.square,
        { backgroundColor: c.surfaceRaised, borderColor: c.border },
        pressed && styles.pressed,
      ]}
    >
      <Icon name="filter" color={c.text} size={20} />
      {count > 0 ? (
        <View
          style={[styles.badge, { backgroundColor: c.accent, borderColor: c.onAccent }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Text variant="caption" style={{ color: c.onAccent, fontFamily: fontFamily.sansSemiBold }}>
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* Filter sheet ------------------------------------------------------------------ */

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/** How many parks and shops in view a draft would show; null while it's still working that out. */
export type FilterCount = { parks: number; shops: number } | null;

/**
 * The sheet edits a draft; "Show 7 parks · 2 shops" applies it, ✕ or the
 * dimmed strip drops it. `countFor` says what's in view for a draft.
 */
export function FilterSheet({
  visible,
  filters,
  onApply,
  onClose,
  countFor,
}: {
  visible: boolean;
  filters: MapFilters;
  onApply: (next: MapFilters) => void;
  onClose: () => void;
  countFor: (draft: MapFilters) => FilterCount;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const [draft, setDraft] = useState(filters);
  const [wasVisible, setWasVisible] = useState(visible);

  // Each time it opens, start from what's on the map.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(filters);
  }

  const count = countFor(draft);
  const set = (patch: Partial<MapFilters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Sheet visible={visible} title={t('map.filters.title')} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.sheetBody}>
        <Caption>{t('map.filters.onTheMap')}</Caption>
        <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
          <ShowShopsRow on={draft.showShops} onPress={() => set({ showShops: !draft.showShops })} />
        </View>

        <Caption>{t('map.filters.whoCanSkate')}</Caption>
        <View style={styles.chips} accessibilityRole="none">
          {FILTER_DISCIPLINES.map((d: Discipline) => (
            <Chip
              key={d}
              label={t(`disciplines.${d}`)}
              picked={draft.disciplines.includes(d)}
              onPress={() => set({ disciplines: toggle(draft.disciplines, d) })}
            />
          ))}
        </View>
        <Text variant="bodySm" color="textSecondary" style={styles.hint}>
          {t('map.filters.whoCanSkateHint')}
        </Text>

        <Caption>{t('map.filters.setting')}</Caption>
        <View style={styles.chips}>
          {SETTING_CHOICES.map((s: SettingChoice) => (
            <Chip
              key={s}
              label={t(`map.filters.settings.${s}`)}
              picked={draft.settings.includes(s)}
              onPress={() => set({ settings: toggle(draft.settings, s) })}
            />
          ))}
        </View>
        <Text variant="bodySm" color="textSecondary" style={styles.hint}>
          {t('map.filters.settingHint')}
        </Text>

        <Caption>{t('map.filters.onlyShow')}</Caption>
        <View style={[styles.rows, { borderTopColor: c.borderSubtle }]}>
          <CheckRow
            title={t('map.filters.openNow')}
            note={t('map.filters.openNowHint')}
            checked={draft.openNow}
            onPress={() => set({ openNow: !draft.openNow })}
          />
          <CheckRow
            title={t('map.filters.free')}
            note={t('map.filters.freeHint')}
            checked={draft.free}
            onPress={() => set({ free: !draft.free })}
          />
          <CheckRow
            title={t('map.filters.lit')}
            note={t('map.filters.litHint')}
            checked={draft.lit}
            onPress={() => set({ lit: !draft.lit })}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: c.borderSubtle }]}>
        <Button variant="secondary" label={t('map.filters.clear')} onPress={() => setDraft(NO_FILTERS)} />
        <Button
          label={
            count === null
              ? t('map.filters.showLoading')
              : draft.showShops
                ? t('map.filters.showBoth', {
                    parks: t('map.filters.parks', { count: count.parks }),
                    shops: t('map.filters.shops', { count: count.shops }),
                  })
                : t('map.filters.show', { count: count.parks })
          }
          onPress={() => onApply(draft)}
          style={styles.flex}
        />
      </View>
    </Sheet>
  );
}

/** Show shops: a switch with the shop pin's own ink square beside it. */
function ShowShopsRow({ on, onPress }: { on: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${t('map.filters.showShops')}, ${t('map.filters.showShopsHint')}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: c.borderSubtle }, pressed && styles.pressed]}
    >
      <View style={[styles.shopIcon, { backgroundColor: c.text }]}>
        <Icon name="storefront" color={c.surface} size={18} />
      </View>
      <View style={styles.flex}>
        <Text variant="headline">{t('map.filters.showShops')}</Text>
        <Text variant="caption" color="textSecondary">
          {t('map.filters.showShopsHint')}
        </Text>
      </View>
      <View
        style={[
          styles.switch,
          { borderColor: c.border, backgroundColor: on ? c.accent : c.surfaceRaised },
          on ? styles.switchOn : null,
        ]}
      >
        <View style={[styles.knob, { backgroundColor: on ? c.onAccent : c.border }]} />
      </View>
    </Pressable>
  );
}

function CheckRow({
  title,
  note,
  checked,
  onPress,
}: {
  title: string;
  note?: string;
  checked: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={note ? `${title}, ${note}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.borderSubtle, backgroundColor: checked ? c.accentSubtle : 'transparent' },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.flex}>
        <Text variant="headline" style={{ color: checked ? c.onAccentSubtle : c.text }}>
          {title}
        </Text>
        {note ? (
          <Text variant="caption" style={{ color: checked ? c.onAccentSubtleSecondary : c.textSecondary }}>
            {note}
          </Text>
        ) : null}
      </View>
      <CheckBox checked={checked} c={c} />
    </Pressable>
  );
}

/* Edge marker ------------------------------------------------------------------- */

/**
 * One off-screen park as a tag at the map's edge: an arrow pointing at it,
 * its name and its distance. A small ink offset lifts it off the map.
 */
export function EdgeTag({
  name,
  distance,
  angle,
  edge,
  left,
  top,
  onPress,
  onSize,
}: {
  name: string;
  distance: string | null;
  angle: number;
  edge: Edge;
  left: number;
  top: number;
  onPress: () => void;
  onSize: (s: { width: number; height: number }) => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const arrow = (
    <View style={{ transform: [{ rotate: `${Math.round(angle)}deg` }] }}>
      <Icon name="arrowUp" color={c.text} size={16} />
    </View>
  );
  // On the right edge the arrow sits after the name, pointing out of the map.
  const arrowLast = edge === 'right';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        distance ? t('map.edge.label', { park: name, distance }) : t('map.edge.labelNoDistance', { park: name })
      }
      accessibilityHint={t('map.edge.hint')}
      onPress={onPress}
      onLayout={(e) => onSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      style={({ pressed }) => [
        styles.edge,
        { left, top, backgroundColor: c.surfaceRaised, borderColor: c.border, boxShadow: `3px 3px 0px ${c.border}` },
        pressed && styles.pressed,
      ]}
    >
      {arrowLast ? null : arrow}
      <Text variant="bodySm" numberOfLines={1} style={[styles.edgeName, { fontFamily: fontFamily.sansSemiBold }]}>
        {name}
      </Text>
      {distance ? (
        <Text variant="bodySm" color="textSecondary" style={{ fontFamily: fontFamily.sansSemiBold }}>
          {`· ${distance}`}
        </Text>
      ) : null}
      {arrowLast ? arrow : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  square: {
    width: size.tapMin,
    height: size.tapMin,
    borderWidth: stroke.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -9,
    right: -9,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 4,
    borderWidth: stroke.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: { paddingBottom: space[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingHorizontal: 20 },
  hint: { paddingHorizontal: 20, paddingTop: space[2] },
  rows: { borderTopWidth: 1 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: 20,
    paddingVertical: space[2],
    borderBottomWidth: 1,
  },
  footer: { flexDirection: 'row', gap: space[2], padding: space[4], borderTopWidth: 1 },
  shopIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  switch: { width: 40, height: 22, borderWidth: stroke.rule, padding: 2, justifyContent: 'center' },
  switchOn: { alignItems: 'flex-end' },
  knob: { width: 14, height: 14 },
  edge: {
    position: 'absolute',
    height: 44,
    maxWidth: 220,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 6,
    paddingRight: 10,
  },
  edgeName: { flexShrink: 1 },
});
