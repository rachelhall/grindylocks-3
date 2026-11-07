/**
 * Logos are 512 px square PNGs with transparency kept, like the app's Add
 * logo (PR 5). The image is fitted inside the square, then scaled by `zoom`
 * and moved by `offset` (fractions of the square, so the preview and the
 * saved file agree at any size). Send claim invite uses the defaults; Change
 * logo (brand and shop web tools) passes the dialog's zoom and position.
 */
export const LOGO_SIZE = 512;

export type LogoCrop = { zoom: number; offset: { x: number; y: number } };
export const DEFAULT_CROP: LogoCrop = { zoom: 1, offset: { x: 0, y: 0 } };

/** Where the image sits in a square of `size`, for the preview and the canvas alike. */
export function logoRect(width: number, height: number, size: number, crop: LogoCrop) {
  const fit = Math.min(size / width, size / height) * crop.zoom;
  const w = width * fit;
  const h = height * fit;
  return { x: (size - w) / 2 + crop.offset.x * size, y: (size - h) / 2 + crop.offset.y * size, w, h };
}

export async function toLogoPng(file: Blob, crop: LogoCrop = DEFAULT_CROP): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_SIZE;
  canvas.height = LOGO_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const r = logoRect(bitmap.width, bitmap.height, LOGO_SIZE, crop);
  ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

export const LOGO_TYPES = /^image\/(png|jpeg|webp)$/;
