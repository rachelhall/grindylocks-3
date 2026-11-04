import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import bold from 'expo-symbols/androidWeights/bold';
import semiBold from 'expo-symbols/androidWeights/semiBold';
import { router } from 'expo-router';
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionSheetIOS,
  ActivityIndicator,
  type KeyboardTypeOptions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { fontFamily, size, space, stroke, Text, type ThemeColors, useColors } from '@/theme';

/* Icons ------------------------------------------------------------------ */

const icons = {
  back: { ios: 'arrow.left', android: 'arrow_back' },
  check: { ios: 'checkmark', android: 'check' },
  search: { ios: 'magnifyingglass', android: 'search' },
  close: { ios: 'xmark', android: 'close' },
  add: { ios: 'plus', android: 'add' },
  play: { ios: 'play.fill', android: 'play_arrow' },
  retry: { ios: 'arrow.clockwise', android: 'refresh' },
  trash: { ios: 'trash', android: 'delete' },
  sync: { ios: 'arrow.triangle.2.circlepath', android: 'sync' },
  photo: { ios: 'photo', android: 'image' },
  video: { ios: 'video', android: 'videocam' },
  home: { ios: 'house', android: 'home' },
  homeFill: { ios: 'house.fill', android: 'home' },
  map: { ios: 'map', android: 'map' },
  mapFill: { ios: 'map.fill', android: 'map' },
  bell: { ios: 'bell', android: 'notifications' },
  bellFill: { ios: 'bell.fill', android: 'notifications' },
  person: { ios: 'person', android: 'person' },
  personFill: { ios: 'person.fill', android: 'person' },
  bookmark: { ios: 'bookmark', android: 'bookmark' },
  bookmarkFill: { ios: 'bookmark.fill', android: 'bookmark' },
  pin: { ios: 'mappin', android: 'location_on' },
  // Tagging sheets (Nov 2 mockups).
  chevronDown: { ios: 'chevron.down', android: 'expand_more' },
  homePin: { ios: 'house.circle', android: 'home_pin' },
  pinOff: { ios: 'mappin.slash', android: 'location_off' },
  addPin: { ios: 'mappin.and.ellipse', android: 'add_location_alt' },
  category: { ios: 'square.grid.2x2', android: 'category' },
  info: { ios: 'info.circle', android: 'info' },
  directions: { ios: 'arrow.triangle.turn.up.right.diamond', android: 'directions' },
  locate: { ios: 'location', android: 'my_location' },
  list: { ios: 'list.bullet', android: 'list' },
  chevron: { ios: 'chevron.right', android: 'chevron_right' },
  chat: { ios: 'bubble.left', android: 'chat' },
  chatFill: { ios: 'bubble.left.fill', android: 'chat' },
  lock: { ios: 'lock.fill', android: 'lock' },
  findPeople: { ios: 'person.2', android: 'person_search' },
  settings: { ios: 'gearshape', android: 'settings' },
  external: { ios: 'arrow.up.right.square', android: 'open_in_new' },
  camera: { ios: 'camera', android: 'add_a_photo' },
  more: { ios: 'ellipsis', android: 'more_horiz' },
  addPhoto: { ios: 'photo.badge.plus', android: 'add_a_photo' },
  landscape: { ios: 'mountain.2', android: 'landscape' },
  heart: { ios: 'heart', android: 'favorite_border' },
  heartFill: { ios: 'heart.fill', android: 'favorite' },
  soundOn: { ios: 'speaker.wave.2.fill', android: 'volume_up' },
  soundOff: { ios: 'speaker.slash.fill', android: 'volume_off' },
  obstacle: { ios: 'square.stack.3d.up', android: 'stacks' },
  people: { ios: 'person.2', android: 'group' },
  copy: { ios: 'doc.on.doc', android: 'content_copy' },
  chevronLeft: { ios: 'chevron.left', android: 'chevron_left' },
  // Notification type badges (Nov 2 mockup).
  badgeComment: { ios: 'bubble.left.fill', android: 'chat_bubble' },
  badgeReply: { ios: 'arrowshape.turn.up.left.fill', android: 'reply' },
  badgeMention: { ios: 'at', android: 'alternate_email' },
  badgeTag: { ios: 'tag.fill', android: 'sell' },
  badgeInvite: { ios: 'envelope.fill', android: 'mail' },
  badgeWave: { ios: 'hand.wave.fill', android: 'waving_hand' },
  badgePlane: { ios: 'airplane.arrival', android: 'flight_land' },
  // Roles and safety (M5 mockups).
  badgeRemoved: { ios: 'hammer.fill', android: 'gavel' },
  badgeWarning: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  badgeRole: { ios: 'shield.fill', android: 'shield_person' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  mail: { ios: 'envelope', android: 'mail' },
  mailSent: { ios: 'envelope.open', android: 'mark_email_read' },
  chevronUp: { ios: 'chevron.up', android: 'expand_less' },
  // Feed media framing (v2 mockups).
  expand: { ios: 'arrow.up.left.and.arrow.down.right', android: 'open_in_full' },
  dragVertical: { ios: 'arrow.up.and.down', android: 'swap_vert' },
  dragHorizontal: { ios: 'arrow.left.and.right', android: 'swap_horiz' },
  recenter: { ios: 'viewfinder', android: 'center_focus_strong' },
  filter: { ios: 'slider.horizontal.3', android: 'tune' },
  arrowUp: { ios: 'arrow.up', android: 'north' },
  // Meetups (v2 mockups).
  checkIn: { ios: 'mappin.and.ellipse', android: 'where_to_vote' },
  timer: { ios: 'timer', android: 'timer' },
  calendar: { ios: 'calendar', android: 'calendar_today' },
  clock: { ios: 'clock', android: 'schedule' },
  repeat: { ios: 'repeat', android: 'repeat' },
  coHost: { ios: 'person.badge.plus', android: 'group_add' },
  titleText: { ios: 'textformat', android: 'title' },
  skate: { ios: 'figure.roll', android: 'roller_skating' },
  globe: { ios: 'globe', android: 'public' },
  eye: { ios: 'eye', android: 'visibility' },
  eyeOff: { ios: 'eye.slash', android: 'visibility_off' },
  alarm: { ios: 'alarm', android: 'alarm' },
  // Meetup changes (PR 5).
  edit: { ios: 'pencil', android: 'edit' },
  calendarOff: { ios: 'calendar.badge.minus', android: 'event_busy' },
  flag: { ios: 'flag', android: 'flag' },
  rain: { ios: 'cloud.rain', android: 'rainy' },
  block: { ios: 'nosign', android: 'block' },
} as const satisfies Record<string, SymbolViewProps['name']>;

export type IconName = keyof typeof icons;

/**
 * SF Symbols on iOS, Material Symbols on Android. Always decorative.
 * `heavy` is for icons with no filled form (search) when they mark the
 * current tab.
 */
export function Icon({
  name,
  color,
  size: s = size.icon,
  heavy,
}: {
  name: IconName;
  color: string;
  size?: number;
  heavy?: boolean;
}) {
  return (
    <SymbolView
      name={icons[name]}
      tintColor={color}
      size={s}
      weight={heavy ? { ios: 'heavy', android: bold } : { ios: 'semibold', android: semiBold }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/* Buttons ---------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'tertiary';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Small second line, e.g. "Coming soon". */
  note?: string;
  /** An icon before the label (Help's Email button). */
  icon?: IconName;
  /** Override colors, for brand-layer screens that are always dark. */
  palette?: { fill: string; text: string; border: string };
  style?: ViewStyle;
};

/**
 * Square, 56px tall. Primary is an ink fill, secondary a 2px outline,
 * tertiary a bare text button (still 48px tall to tap).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  note,
  icon,
  palette,
  style,
}: ButtonProps) {
  const c = useColors();
  const inactive = disabled || loading;

  const fill = palette?.fill ?? (variant === 'primary' ? c.text : 'transparent');
  const text = palette?.text ?? (variant === 'primary' ? c.surface : c.text);
  const border = palette?.border ?? (variant === 'secondary' ? c.border : 'transparent');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={note ? `${label}, ${note}` : label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'tertiary' && styles.buttonTertiary,
        { backgroundColor: fill, borderColor: border },
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={text} />
      ) : (
        <View style={styles.buttonInner}>
          <View style={styles.buttonLabel}>
            {icon ? <Icon name={icon} color={text} size={20} /> : null}
            <Text variant="headline" style={{ color: text, fontSize: 16 }}>
              {label}
            </Text>
          </View>
          {note ? (
            <Text variant="label" style={{ color: text }}>
              {note}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** Square back button for the top of a screen. */
export function BackButton({ onPress }: { onPress?: () => void }) {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      onPress={onPress ?? (() => router.back())}
      hitSlop={4}
      style={({ pressed }) => [
        styles.back,
        { backgroundColor: c.surfaceRaised },
        pressed && styles.buttonPressed,
      ]}
    >
      <Icon name="back" color={c.text} size={22} />
    </Pressable>
  );
}

/** Back button plus a segmented progress bar, as in the onboarding mockups. */
export function StepHeader({ step, total, canGoBack }: { step: number; total: number; canGoBack: boolean }) {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <View style={styles.stepHeader}>
      {canGoBack ? <BackButton /> : <View style={styles.backSpacer} />}
      <View
        style={styles.segments}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('onboarding.step', { current: step, total })}
      >
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={[styles.segment, { backgroundColor: i < step ? c.text : c.borderSubtle }]}
          />
        ))}
      </View>
    </View>
  );
}

/* Action sheets ------------------------------------------------------------ */

export type SheetAction = { label: string; onPress: () => void; destructive?: boolean };
/** `message` is a smaller line under the title (a role holder's report summary). */
type SheetRequest = { title?: string; message?: string; actions: SheetAction[] };

/**
 * A short list of actions for a More button: the native action sheet on
 * iOS, a plain bottom sheet on Android (alerts there fit only three
 * buttons). Render `sheet` once in the screen and call `show`.
 */
export function useActionSheet(): { sheet: ReactNode; show: (request: SheetRequest) => void } {
  const { t } = useTranslation();
  const c = useColors();
  const [request, setRequest] = useState<SheetRequest | null>(null);

  const show = useCallback(
    ({ title, message, actions }: SheetRequest) => {
      if (actions.length === 0) return;
      if (Platform.OS === 'ios') {
        const destructive = actions.flatMap((a, i) => (a.destructive ? [i] : []));
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title,
            message,
            options: [...actions.map((a) => a.label), t('common.cancel')],
            cancelButtonIndex: actions.length,
            destructiveButtonIndex: destructive.length ? destructive : undefined,
          },
          (i) => actions[i]?.onPress(),
        );
      } else {
        setRequest({ title, message, actions });
      }
    },
    [t],
  );

  const close = () => setRequest(null);
  const sheet = (
    <Modal visible={request !== null} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable accessibilityLabel={t('common.cancel')} style={styles.sheetScrim} onPress={close} />
      <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>
        {request?.title ? (
          <Text variant="label" color="textSecondary" style={styles.sheetTitle}>
            {request.title}
          </Text>
        ) : null}
        {request?.message ? (
          <Text variant="bodySm" color="textSecondary" style={styles.sheetMessage}>
            {request.message}
          </Text>
        ) : null}
        {request?.actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            onPress={() => {
              close();
              a.onPress();
            }}
            style={({ pressed }) => [styles.sheetRow, { borderTopColor: c.borderSubtle }, pressed && styles.buttonPressed]}
          >
            <Text variant="headline" color={a.destructive ? 'statusClosed' : 'text'}>
              {a.label}
            </Text>
          </Pressable>
        ))}
        <Button label={t('common.cancel')} variant="secondary" onPress={close} style={styles.sheetCancel} />
      </View>
    </Modal>
  );

  return { sheet, show };
}

/* Inputs ----------------------------------------------------------------- */

type FieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  /** Shown after the label in a lighter weight, e.g. "(optional)". */
  labelNote?: string;
  prefix?: string;
  icon?: IconName;
  accessory?: ReactNode;
  error?: string | null;
  hint?: string;
  keyboardType?: KeyboardTypeOptions;
  inputSize?: 'normal' | 'large';
};

export function TextField({
  label,
  labelNote,
  prefix,
  icon,
  accessory,
  error,
  hint,
  inputSize = 'normal',
  ...input
}: FieldProps) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text variant="bodySm" style={{ fontFamily: fontFamily.sansSemiBold }}>
        {label}
        {labelNote ? <Text variant="bodySm" color="textSecondary">{` ${labelNote}`}</Text> : null}
      </Text>
      <View
        style={[
          styles.inputBox,
          { backgroundColor: c.surfaceRaised, borderColor: error ? c.statusClosed : c.border },
        ]}
      >
        {icon ? <Icon name={icon} color={c.text} size={20} /> : null}
        {prefix ? (
          <Text variant="headline" color="textSecondary">
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.textMuted}
          selectionColor={c.accent}
          cursorColor={c.text}
          style={[
            styles.input,
            { color: c.text },
            inputSize === 'large' && styles.inputLarge,
          ]}
          {...input}
        />
        {accessory}
      </View>
      {error ? (
        <Text variant="bodySm" color="statusClosed" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="bodySm" color="textSecondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/* Choices ---------------------------------------------------------------- */

/** Square checkbox: pink fill, 2px ink outline and an ink check when picked. */
export function CheckBox({ checked, c }: { checked: boolean; c: ThemeColors }) {
  return (
    <View
      style={[
        styles.checkbox,
        {
          backgroundColor: checked ? c.accent : c.surfaceRaised,
          borderColor: checked ? c.onAccent : c.border,
        },
      ]}
    >
      {checked ? <Icon name="check" color={c.onAccent} size={16} /> : null}
    </View>
  );
}

/** A multi-select card. Picked cards get the accent-subtle tint plus the check. */
export function ChoiceCard({
  title,
  subtitle,
  checked,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const c = useColors();
  const titleColor = checked ? c.onAccentSubtle : c.text;
  const subColor = checked ? c.onAccentSubtleSecondary : c.textSecondary;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: checked ? c.accentSubtle : c.surfaceRaised, borderColor: c.border },
        pressed && styles.buttonPressed,
      ]}
    >
      <CheckBox checked={checked} c={c} />
      <View style={styles.choiceText}>
        <Text variant="headline" style={{ color: titleColor }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodySm" style={{ color: subColor }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A single-select row in a list (cities, parks), with an optional line under the title. */
export function SelectRow({
  title,
  subtitle,
  detail,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={[title, subtitle, detail].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectRow,
        subtitle && styles.selectRowTall,
        {
          backgroundColor: selected ? c.accentSubtle : c.surfaceRaised,
          borderColor: selected ? c.border : c.borderSubtle,
        },
        pressed && styles.buttonPressed,
      ]}
    >
      {subtitle ? (
        <View style={styles.choiceText}>
          <Text variant="headline" style={{ color: selected ? c.onAccentSubtle : c.text }}>
            {title}
          </Text>
          <Text variant="bodySm" style={{ color: selected ? c.onAccentSubtleSecondary : c.textSecondary }}>
            {subtitle}
          </Text>
        </View>
      ) : (
        <Text variant="headline" style={{ flex: 1, color: selected ? c.onAccentSubtle : c.text }}>
          {title}
        </Text>
      )}
      {detail ? (
        <Text variant="label" style={{ color: selected ? c.onAccentSubtleSecondary : c.textSecondary }}>
          {detail}
        </Text>
      ) : null}
      {selected ? <Icon name="check" color={c.onAccentSubtle} size={20} /> : null}
    </Pressable>
  );
}

/**
 * Square on/off switch. `fg` is the color of the surface it sits on's text,
 * used for the off state's outline and knob.
 */
export function Toggle({
  value,
  onChange,
  label,
  fg,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  fg: string;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      hitSlop={9}
      style={[
        styles.toggle,
        value
          ? { backgroundColor: c.accent, borderColor: c.accent, alignItems: 'flex-end' }
          : { backgroundColor: 'transparent', borderColor: fg, alignItems: 'flex-start' },
      ]}
    >
      <View style={[styles.knob, { backgroundColor: value ? c.onAccent : fg }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    borderWidth: stroke.rule,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonTertiary: { minHeight: size.tapMin },
  buttonInner: { alignItems: 'center', gap: 2 },
  buttonLabel: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.75 },
  back: { width: size.tapMin, height: size.tapMin, alignItems: 'center', justifyContent: 'center' },
  backSpacer: { width: 0, height: size.tapMin },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  segments: { flex: 1, flexDirection: 'row', gap: space[1] },
  segment: { flex: 1, height: 6 },
  field: { gap: 6 },
  inputBox: {
    minHeight: 56,
    borderWidth: stroke.rule,
    paddingHorizontal: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 18,
    paddingVertical: space[3],
  },
  inputLarge: { fontSize: 28, letterSpacing: 6 },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: stroke.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choice: {
    minHeight: 64,
    borderWidth: stroke.rule,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  choiceText: { flex: 1 },
  selectRow: {
    minHeight: 52,
    borderWidth: stroke.rule,
    paddingHorizontal: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  selectRowTall: { paddingVertical: space[2] },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(17,17,17,0.5)' },
  sheet: { borderTopWidth: stroke.rule, paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[6] },
  sheetTitle: { paddingVertical: space[2] },
  sheetMessage: { paddingBottom: space[2] },
  sheetRow: { minHeight: 56, justifyContent: 'center', borderTopWidth: stroke.hairline },
  sheetCancel: { marginTop: space[3] },
  toggle: { width: 50, height: 30, borderWidth: stroke.rule, padding: 1, justifyContent: 'center' },
  knob: { width: 22, height: 22 },
});
