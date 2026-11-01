/**
 * The park page header's backdrop: a photocopied park photo (grayscale,
 * punchy contrast, darkened) under a pink halftone that fades in along the
 * diagonal, or the halftone alone on ink when a park has no photo yet.
 *
 * Drawn with Skia runtime shaders so the filter matches the mockup's CSS
 * (`grayscale(1) contrast(1.6) brightness(.48)`), including CSS's clamp
 * after the contrast step: the brightest pixel of any photo ends at
 * PHOTOCOPY.brightness grey, which keeps the paper park name readable on
 * bright photos (about 3.7:1 at 0.48).
 *
 * Tune the look here, and only here.
 */
import { Canvas, Fill, ImageShader, Shader, Skia, useImage } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';

import { brand } from '@/theme';

/** The photocopy filter. To make the park name stand out more on bright photos, lower `brightness`. */
export const PHOTOCOPY = {
  /** 1 is unchanged; the mockup uses 1.6. */
  contrast: 1.6,
  /** Multiplies every channel after the contrast step; the brightest white ends at this grey. */
  brightness: 0.48,
} as const;

/** The pink halftone, in points: 2pt-radius dots on an 8pt grid. */
export const HALFTONE = {
  color: brand.pink,
  cell: 8,
  radius: 2,
  /**
   * Fade along the top-left → bottom-right diagonal: 0 is the top-left
   * corner, 1 the bottom-right. Transparent before `fadeFrom`, full from `fadeTo`.
   */
  fadeFrom: 0.18,
  fadeTo: 1,
} as const;

const HALFTONE_SKSL = `
uniform float2 size;
uniform float4 dotColor;
uniform float cell;
uniform float radius;
uniform float fadeFrom;
uniform float fadeTo;

float halftone(float2 p) {
  float2 q = mod(p, cell) - cell * 0.5;
  float coverage = 1.0 - smoothstep(radius - 0.5, radius + 0.5, length(q));
  float t = (p.x / size.x + p.y / size.y) * 0.5;
  float fade = clamp((t - fadeFrom) / max(fadeTo - fadeFrom, 0.0001), 0.0, 1.0);
  return coverage * fade * dotColor.a;
}
`;

const inkHalftone = Skia.RuntimeEffect.Make(`
${HALFTONE_SKSL}
uniform float4 ground;

half4 main(float2 p) {
  return half4(mix(ground.rgb, dotColor.rgb, halftone(p)), 1.0);
}
`)!;

const photoHalftone = Skia.RuntimeEffect.Make(`
${HALFTONE_SKSL}
uniform shader image;
uniform float contrast;
uniform float brightness;

half4 main(float2 p) {
  float3 c = image.eval(p).rgb;
  // CSS grayscale(1), contrast() and brightness(), clamped between steps like CSS.
  float l = dot(c, float3(0.2126, 0.7152, 0.0722));
  l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
  l = clamp(l * brightness, 0.0, 1.0);
  return half4(mix(float3(l), dotColor.rgb, halftone(p)), 1.0);
}
`)!;

/** "#FF48B0" → [r, g, b, a] in 0–1. */
function rgba(hex: string, alpha = 1): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

/**
 * Fills its parent (absolutely positioned). With a `photoUrl` the photo is
 * cropped to cover; until it loads, or without one, it's the ink halftone.
 */
export function PhotocopyBackdrop({
  width,
  height,
  photoUrl,
}: {
  width: number;
  height: number;
  photoUrl?: string | null;
}) {
  const image = useImage(photoUrl ?? null);
  const shared = {
    size: [width, height],
    dotColor: rgba(HALFTONE.color),
    cell: HALFTONE.cell,
    radius: HALFTONE.radius,
    fadeFrom: HALFTONE.fadeFrom,
    fadeTo: HALFTONE.fadeTo,
  };

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill>
        {image ? (
          <Shader
            source={photoHalftone}
            uniforms={{ ...shared, contrast: PHOTOCOPY.contrast, brightness: PHOTOCOPY.brightness }}
          >
            <ImageShader image={image} fit="cover" rect={{ x: 0, y: 0, width, height }} />
          </Shader>
        ) : (
          <Shader source={inkHalftone} uniforms={{ ...shared, ground: rgba(brand.ink) }} />
        )}
      </Fill>
    </Canvas>
  );
}
