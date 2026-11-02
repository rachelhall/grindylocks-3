import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { SafeAreaView } from '@/components/safe-area';

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
  backdrop,
  edges,
}: {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  background?: string;
  /** Drawn behind everything, filling the screen (the brand screens' halftone). */
  backdrop?: ReactNode;
  /** Leave out 'top' when the screen sits in a pageSheet, already below the status bar. */
  edges?: Edge[];
}) {
  const c = useColors();
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: background ?? c.surface }]}>
      {backdrop}
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
