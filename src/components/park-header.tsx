import { Canvas, Fill, ImageShader, Shader, Skia, type SkRuntimeEffect, useImage } from '@shopify/react-native-skia';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui';
import { brand, size, space, stroke, Text, useColors } from '@/theme';

/** Height of the park page header, status bar included. */
export const HEADER_HEIGHT = 300;

/**
 * The photocopy look for the header photo, in one place to tune by eye
 * against the "Park page · with a park photo" mockup. Applied in this order,
 * each step clamped, like the mockup's CSS filter
 * `grayscale(1) contrast(1.6) brightness(.48)` (brightness nudged down, below).
 *
 * If the paper park name gets hard to read on a bright photo, lower
 * `brightness` rather than adding an ink block or gradient behind it.
 */
export const PHOTOCOPY = {
  /** 1 = fully grey. */
  grayscale: 1,
  /** Around mid-grey: 1 leaves it, higher pushes greys to black and white. */
  contrast: 1.6,
  /**
   * Multiplies the result. The mockup's 0.48 leaves a white photo at 3.7:1
   * against the paper name; 0.42 brings that to 4.6:1 and still reads like
   * the mockup on an ordinary photo.
   */
  brightness: 0.42,
} as const;

/**
 * The pink halftone over the header, photo or not: dots of `dotRadius` on
 * a `cell` grid, faded in along the diagonal from transparent at the
 * top-left (`fadeStart`) to full at the bottom-right (`fadeEnd`), as a
 * fraction of the way across.
 */
export const HALFTONE = {
  cell: 8,
  dotRadius: 2,
  fadeStart: 0.18,
  fadeEnd: 1,
} as const;

const HALFTONE_SKSL = `
uniform float2 size;
uniform float cell;
uniform float dotRadius;
uniform float fadeStart;
uniform float fadeEnd;
uniform float4 pink;

// How much pink at this point: a soft-edged dot centered in each cell,
// times the diagonal fade.
float halftone(float2 xy) {
  float2 offset = mod(xy, cell) - cell * 0.5;
  float dotAlpha = 1.0 - smoothstep(dotRadius - 0.2, dotRadius + 0.4, length(offset));
  float t = (xy.x / size.x + xy.y / size.y) * 0.5;
  float fade = clamp((t - fadeStart) / max(fadeEnd - fadeStart, 0.001), 0.0, 1.0);
  return dotAlpha * fade;
}
`;

/** Ink ground plus halftone, for parks with no photo (or while it loads). */
const INK_SKSL = `${HALFTONE_SKSL}
uniform float4 ink;

half4 main(float2 xy) {
  return half4(mix(ink.rgb, pink.rgb, halftone(xy)), 1.0);
}
`;

/** The photo, photocopied, plus halftone. */
const PHOTO_SKSL = `${HALFTONE_SKSL}
uniform shader photo;
uniform float grayscale;
uniform float contrast;
uniform float brightness;

half4 main(float2 xy) {
  float3 c = photo.eval(xy).rgb;
  float luma = dot(c, float3(0.2126, 0.7152, 0.0722));
  c = mix(c, float3(luma), grayscale);
  c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
  c = clamp(c * brightness, 0.0, 1.0);
  return half4(mix(c, pink.rgb, halftone(xy)), 1.0);
}
`;

// Compiled on first use, not at import, so nothing runs before Skia loads.
let effects: { ink: SkRuntimeEffect; photo: SkRuntimeEffect } | null = null;
function getEffects() {
  if (!effects) {
    const ink = Skia.RuntimeEffect.Make(INK_SKSL);
    const photo = Skia.RuntimeEffect.Make(PHOTO_SKSL);
    if (!ink || !photo) throw new Error('Park header shaders failed to compile');
    effects = { ink, photo };
  }
  return effects;
}

function rgba(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

/** The header's background: the photocopied photo, or ink, with the halftone. */
function HeaderArt({ photoUrl, width }: { photoUrl: string | null; width: number }) {
  const image = useImage(photoUrl);
  const { ink, photo } = getEffects();
  const halftone = {
    size: [width, HEADER_HEIGHT],
    cell: HALFTONE.cell,
    dotRadius: HALFTONE.dotRadius,
    fadeStart: HALFTONE.fadeStart,
    fadeEnd: HALFTONE.fadeEnd,
    pink: rgba(brand.pink),
  };
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill>
        {image ? (
          <Shader source={photo} uniforms={{ ...halftone, ...PHOTOCOPY }}>
            <ImageShader image={image} fit="cover" rect={{ x: 0, y: 0, width, height: HEADER_HEIGHT }} />
          </Shader>
        ) : (
          <Shader source={ink} uniforms={{ ...halftone, ink: rgba(brand.ink) }} />
        )}
      </Fill>
    </Canvas>
  );
}

/**
 * The park header's ink and pink halftone, filling its parent, for other
 * brand screens (the welcome and invite screens). The fade runs along the
 * diagonal like the header's; `fromTopRight` flips it so the dots gather in
 * the top-right corner instead of the bottom-right.
 */
export function HalftoneGround({
  fadeStart = HALFTONE.fadeStart,
  fadeEnd = HALFTONE.fadeEnd,
  fromTopRight = false,
}: {
  fadeStart?: number;
  fadeEnd?: number;
  fromTopRight?: boolean;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!box || box.width !== width || box.height !== height) setBox({ width, height });
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {box ? (
        <Canvas style={[StyleSheet.absoluteFill, fromTopRight && styles.flipY]}>
          <Fill>
            <Shader
              source={getEffects().ink}
              uniforms={{
                size: [box.width, box.height],
                cell: HALFTONE.cell,
                dotRadius: HALFTONE.dotRadius,
                fadeStart,
                fadeEnd,
                pink: rgba(brand.pink),
                ink: rgba(brand.ink),
              }}
            />
          </Fill>
        </Canvas>
      ) : null}
    </View>
  );
}

/** 48px paper square with an ink icon, for the top of the header. */
function HeaderButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.square, pressed && styles.pressed]}
    >
      <Icon name={icon} color={brand.ink} size={22} />
    </Pressable>
  );
}

/**
 * The park page header, per the Park page mockups: ink with a pink halftone,
 * or the park's first photo photocopied, with the pink tape label and the
 * park name bottom-left and Back / (Add photos) / More along the top.
 *
 * The header is always dark whatever the theme, so it uses the brand paper
 * and ink directly; pink is the accent.
 */
export function ParkHeader({
  name,
  tape,
  photoUrl,
  onBack,
  onMore,
  onOpenGallery,
  onAddPhotos,
}: {
  name: string;
  /** "NASHVILLE · SKATEPARK" */
  tape: string;
  /** The first park photo, or null for the plain ink header. */
  photoUrl: string | null;
  onBack: () => void;
  onMore: () => void;
  /** Set when there are photos: a tap anywhere on the header opens them. */
  onOpenGallery?: () => void;
  /** Set for people who can add photos. */
  onAddPhotos?: () => void;
}) {
  const { t } = useTranslation();
  const c = useColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { backgroundColor: brand.ink }]}>
      <HeaderArt photoUrl={photoUrl} width={width} />

      {onOpenGallery ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('parkPhotos.open', { park: name })}
          onPress={onOpenGallery}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View style={styles.titleBlock} pointerEvents="none">
        <View style={[styles.tape, { backgroundColor: c.accent }]}>
          <Text variant="label" style={{ color: c.onAccent }}>
            {tape}
          </Text>
        </View>
        <View>
          {/* A second copy, offset 3px, is the pink shadow: Android won't draw a hard text shadow. */}
          <Text
            variant="displayXl"
            numberOfLines={3}
            style={[styles.name, styles.nameShadow, { color: brand.pink }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {name}
          </Text>
          <Text variant="displayXl" numberOfLines={3} accessibilityRole="header" style={[styles.name, { color: brand.paper }]}>
            {name}
          </Text>
        </View>
      </View>

      <View style={[styles.topRow, { top: Math.max(space[4], insets.top + space[1]) }]}>
        <HeaderButton icon="back" label={t('common.back')} onPress={onBack} />
        <View style={styles.topRight}>
          {onAddPhotos ? (
            <Pressable
              accessibilityRole="button"
              onPress={onAddPhotos}
              hitSlop={4}
              style={({ pressed }) => [
                styles.addPhotos,
                { backgroundColor: c.accent, borderColor: c.onAccent },
                pressed && styles.pressed,
              ]}
            >
              <Icon name="addPhoto" color={c.onAccent} size={20} />
              <Text variant="headline" style={{ color: c.onAccent, fontSize: 16 }}>
                {t('parkPhotos.add')}
              </Text>
            </Pressable>
          ) : null}
          <HeaderButton icon="more" label={t('park.more')} onPress={onMore} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: HEADER_HEIGHT,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    paddingHorizontal: space[4],
    paddingBottom: 20,
  },
  titleBlock: { alignItems: 'flex-start', gap: space[2] },
  tape: { paddingHorizontal: space[2], paddingVertical: space[1], transform: [{ rotate: '-2deg' }] },
  name: { letterSpacing: -0.48 },
  nameShadow: { position: 'absolute', top: 3, left: 3, right: -3 },
  topRow: {
    position: 'absolute',
    left: space[4],
    right: space[4],
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space[2],
  },
  topRight: { flexDirection: 'row', gap: space[2] },
  square: {
    width: size.tapMin,
    height: size.tapMin,
    backgroundColor: brand.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotos: {
    height: size.tapMin,
    paddingHorizontal: 14,
    borderWidth: stroke.rule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  pressed: { opacity: 0.75 },
  flipY: { transform: [{ scaleY: -1 }] },
});
