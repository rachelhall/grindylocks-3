import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import semiBold from 'expo-symbols/androidWeights/semiBold';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  type KeyboardTypeOptions,
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
} as const satisfies Record<string, SymbolViewProps['name']>;

export type IconName = keyof typeof icons;

/** SF Symbols on iOS, Material Symbols on Android. Always decorative. */
export function Icon({ name, color, size: s = size.icon }: { name: IconName; color: string; size?: number }) {
  return (
    <SymbolView
      name={icons[name]}
      tintColor={color}
      size={s}
      weight={{ ios: 'semibold', android: semiBold }}
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
          <Text variant="headline" style={{ color: text, fontSize: 16 }}>
            {label}
          </Text>
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

/** A single-select row in a list (cities, parks). */
export function SelectRow({
  title,
  detail,
  selected,
  onPress,
}: {
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectRow,
        {
          backgroundColor: selected ? c.accentSubtle : c.surfaceRaised,
          borderColor: selected ? c.border : c.borderSubtle,
        },
        pressed && styles.buttonPressed,
      ]}
    >
      <Text variant="headline" style={{ flex: 1, color: selected ? c.onAccentSubtle : c.text }}>
        {title}
      </Text>
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
  toggle: { width: 50, height: 30, borderWidth: stroke.rule, padding: 1, justifyContent: 'center' },
  knob: { width: 22, height: 22 },
});
