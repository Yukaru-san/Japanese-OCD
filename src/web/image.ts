/** Loading images in the browser and turning them into pixels for the PaddleOCR engine. */
import type { RgbaImage } from './paddle';

/** Images are scaled down by powers of two until their longer side fits (same as on Android). */
export const MAX_IMAGE_SIDE = 4096;

export type Drawable = HTMLCanvasElement | ImageBitmap | HTMLVideoElement | HTMLImageElement;

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available.');
  return ctx;
}

/** Size of something drawable, in its own pixels. */
export function sizeOf(source: Drawable): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  return { width: source.width, height: source.height };
}

/** Draws the source onto a new canvas, optionally scaled. */
export function toCanvas(source: Drawable, width?: number, height?: number): HTMLCanvasElement {
  const size = sizeOf(source);
  const canvas = createCanvas(width ?? size.width, height ?? size.height);
  context(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function pixelsOf(canvas: HTMLCanvasElement): RgbaImage {
  const data = context(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return { data: data.data, width: data.width, height: data.height };
}

/** Rotates a canvas clockwise by a multiple of 90 degrees. */
export function rotate(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const turns = (((degrees / 90) % 4) + 4) % 4;
  if (turns === 0) return canvas;
  const swap = turns % 2 === 1;
  const result = createCanvas(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height);
  const ctx = context(result);
  ctx.translate(result.width / 2, result.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return result;
}

/**
 * Decodes an image upright (EXIF orientation applied by the browser) and not larger than
 * `MAX_IMAGE_SIDE`.
 */
export async function decode(blob: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  let factor = 1;
  while (Math.max(bitmap.width, bitmap.height) / factor > MAX_IMAGE_SIDE) factor *= 2;
  const canvas = toCanvas(bitmap, Math.floor(bitmap.width / factor), Math.floor(bitmap.height / factor));
  bitmap.close();
  return canvas;
}

/** Reads base64 image data, with or without `data:` prefix. */
export function blobFromBase64(base64: string): Blob {
  const comma = base64.indexOf(',');
  const data = base64.startsWith('data:') && comma >= 0 ? base64.substring(comma + 1) : base64;
  const binary = atob(data.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

/** Loads an image from a URL the page can fetch (http(s), blob:, data:, relative path). */
export async function blobFromPath(path: string): Promise<Blob> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), type, quality),
  );
}
