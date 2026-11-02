import { StyleSheet, View, type ViewProps } from 'react-native';
import { type Edge, useSafeAreaInsets } from 'react-native-safe-area-context';

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

/**
 * Drop-in for react-native-safe-area-context's SafeAreaView, padded from the
 * root provider's insets instead of the native view's own measurement.
 *
 * Why: inside a react-native-screens fullScreenModal (New post, Edit profile,
 * Say hi, park photos) the native SafeAreaView measures zero insets on iOS,
 * which put header buttons under the status bar where they can't be tapped.
 *
 * Insets are added to any padding in `style`, like the native view does.
 * Content inside a pageSheet (already below the status bar) should pass
 * edges without 'top'.
 */
export function SafeAreaView({
  edges = ALL_EDGES,
  style,
  ...rest
}: ViewProps & { edges?: readonly Edge[] }) {
  const insets = useSafeAreaInsets();
  const flat = StyleSheet.flatten(style) ?? {};
  const base = (side: 'Top' | 'Bottom' | 'Left' | 'Right') => {
    const axis = side === 'Top' || side === 'Bottom' ? flat.paddingVertical : flat.paddingHorizontal;
    const value = flat[`padding${side}`] ?? axis ?? flat.padding ?? 0;
    return typeof value === 'number' ? value : 0;
  };
  const pad = (edge: Edge, side: 'Top' | 'Bottom' | 'Left' | 'Right') =>
    base(side) + (edges.includes(edge) ? insets[edge] : 0);

  return (
    <View
      {...rest}
      style={[
        style,
        {
          paddingTop: pad('top', 'Top'),
          paddingBottom: pad('bottom', 'Bottom'),
          paddingLeft: pad('left', 'Left'),
          paddingRight: pad('right', 'Right'),
        },
      ]}
    />
  );
}
