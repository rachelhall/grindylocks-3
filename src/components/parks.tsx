import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui';
import { formatClock, type OpenState } from '@/lib/hours';
import type { Discipline, ParkSetting, ParkStatus, ParkType } from '@/lib/parks';
import { size, space, stroke, Text, type ThemeColors, useColors } from '@/theme';

/* Status ----------------------------------------------------------------------- */

/** Text and color for a park's open state, e.g. "Open · until 22:00". */
export function useOpenLabel(state: OpenState | null): { label: string; color: keyof ThemeColors } | null {
  const { t, i18n } = useTranslation();
  if (!state) return null;
  const at = (m: number) => formatClock(m, i18n.language);
  switch (state.kind) {
    case 'open':
      return { label: t('park.openUntil', { time: at(state.until) }), color: 'statusOpen' };
    case 'closed':
      return {
        label: state.opensAt === null ? t('park.closedNow') : t('park.opensAt', { time: at(state.opensAt) }),
        color: 'statusSoon',
      };
    case 'closedToday':
      return { label: t('park.closedToday'), color: 'statusSoon' };
    case 'unknown':
      return { label: t('park.openHoursUnknown'), color: 'statusOpen' };
    case 'status':
      return {
        label: t(`park.status.${state.status}`),
        color:
          state.status === 'temporarily_closed'
            ? 'statusClosed'
            : state.status === 'seasonal_closure'
              ? 'statusSeasonal'
              : 'statusSoon',
      };
  }
}

/** Outlined status chip in the status color. */
export function StatusChip({ state }: { state: OpenState | null }) {
  const c = useColors();
  const open = useOpenLabel(state);
  if (!open) return null;
  return (
    <View style={[styles.chip, { borderColor: c[open.color] }]}>
      <Text variant="label" color={open.color}>
        {open.label}
      </Text>
    </View>
  );
}

/* Saving ---------------------------------------------------------------------- */

/**
 * The "want to skate" bookmark. Saved is a pink-filled bookmark with an ink
 * outline (never pink alone, which is under 3:1 on paper).
 */
export function SaveButton({
  saved,
  onPress,
  parkName,
  boxed,
}: {
  saved: boolean;
  onPress: () => void;
  parkName: string;
  /** Square outlined button (cards) rather than a bare icon (list rows). */
  boxed?: boolean;
}) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      accessibilityLabel={saved ? t('park.savedLabel', { park: parkName }) : t('park.saveLabel', { park: parkName })}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        boxed && { borderWidth: stroke.rule, borderColor: c.border },
        pressed && styles.pressed,
      ]}
    >
      <BookmarkIcon saved={saved} />
    </Pressable>
  );
}

export function BookmarkIcon({ saved, color }: { saved: boolean; color?: string }) {
  const c = useColors();
  if (!saved) return <Icon name="bookmark" color={color ?? c.text} size={22} />;
  return (
    <View style={styles.stack}>
      <Icon name="bookmarkFill" color={c.accent} size={22} />
      <View style={StyleSheet.absoluteFill}>
        <Icon name="bookmark" color={c.onAccent} size={22} />
      </View>
    </View>
  );
}

/* Directions ------------------------------------------------------------------- */

/** Opens Apple Maps on iOS, Google Maps elsewhere. */
export function openDirections(park: { latitude: number | null; longitude: number | null; display_name: string; address?: string | null }) {
  const dest =
    park.latitude !== null && park.longitude !== null
      ? `${park.latitude},${park.longitude}`
      : encodeURIComponent(park.address ?? park.display_name);
  const url =
    Platform.OS === 'ios'
      ? `https://maps.apple.com/?daddr=${dest}&q=${encodeURIComponent(park.display_name)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  void Linking.openURL(url);
}

export function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: 'directions' | 'pin' | 'locate' | 'list';
  label: string;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        { borderWidth: stroke.rule, borderColor: c.border },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} color={c.text} size={22} />
    </Pressable>
  );
}

/* Descriptions ------------------------------------------------------------------- */

/** "Indoor · paid · DIY", for list rows and cards. */
export function useParkLine() {
  const { t } = useTranslation();
  return (park: {
    setting: ParkSetting | null;
    park_type: ParkType;
    night_lighting: boolean | null;
    city?: string;
    is_paid?: boolean;
  }, extra?: string | null) =>
    [
      park.setting ? t(`park.setting.${park.setting}`) : null,
      park.park_type !== 'skatepark' ? t(`park.type.${park.park_type}`) : null,
      park.is_paid ? t('park.paid') : null,
      park.night_lighting ? t('park.lit') : null,
      extra ?? null,
    ]
      .filter(Boolean)
      .join(' · ');
}

/** One chip per discipline. The member's own disciplines are ink with pink text. */
export function DisciplineChips({ disciplines, mine }: { disciplines: Discipline[]; mine: Discipline[] }) {
  const { t } = useTranslation();
  const c = useColors();
  const order: Discipline[] = ['inline', 'quad', 'skateboard', 'bmx', 'scooter'];
  return (
    <View style={styles.chips}>
      {order
        .filter((d) => disciplines.includes(d))
        .map((d) => {
          const own = mine.includes(d);
          return (
            <View
              key={d}
              style={[styles.discipline, { backgroundColor: own ? c.text : c.surface }]}
              accessibilityLabel={own ? t('park.disciplineYours', { discipline: t(`disciplines.${d}`) }) : undefined}
            >
              <Text variant="bodySm" style={{ color: own ? c.accent : c.text, fontWeight: '600' }}>
                {t(`disciplines.${d}`)}
              </Text>
            </View>
          );
        })}
    </View>
  );
}

/* List rows ---------------------------------------------------------------------- */

/**
 * A park in a list (city search, the Search tab): name, one line, a status
 * chip unless open, and the bookmark. The row opens the park page.
 */
export function ParkRow({
  name,
  line,
  status,
  saved,
  onPress,
  onSave,
}: {
  name: string;
  line: string;
  status: ParkStatus;
  saved: boolean;
  onPress: () => void;
  onSave: () => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.parkRow, { backgroundColor: c.surfaceRaised }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={line ? `${name}, ${line}` : name}
        onPress={onPress}
        style={({ pressed }) => [styles.parkMain, pressed && styles.pressed]}
      >
        <Text variant="headline">{name}</Text>
        {line ? (
          <Text variant="bodySm" color="textSecondary">
            {line}
          </Text>
        ) : null}
        {status !== 'open' ? <StatusChip state={{ kind: 'status', status }} /> : null}
      </Pressable>
      <SaveButton saved={saved} onPress={onSave} parkName={name} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', borderWidth: stroke.rule, paddingHorizontal: space[2], paddingVertical: 2 },
  iconButton: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
  stack: { width: 22, height: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  discipline: { paddingHorizontal: 10, paddingVertical: 4 },
  parkRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[3], paddingRight: space[1], paddingVertical: space[2] },
  parkMain: { flex: 1, gap: 3, minWidth: 0 },
});
