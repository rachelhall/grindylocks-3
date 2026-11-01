import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, useColors } from '@/theme';

/**
 * A full-height form screen: scrolling content on top, actions pinned to the
 * bottom, and both lifted above the keyboard.
 */
export function FormScreen({
  header,
  children,
  footer,
  background,
}: {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  background?: string;
}) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: background ?? c.surface }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header ? <View style={styles.header}>{header}</View> : null}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: space[6], paddingTop: space[2] },
  content: { flexGrow: 1, paddingHorizontal: space[6], paddingTop: space[8], paddingBottom: space[6], gap: space[6] },
  footer: { paddingHorizontal: space[6], paddingBottom: space[4], paddingTop: space[2], gap: space[2] },
});
