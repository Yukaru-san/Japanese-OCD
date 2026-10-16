import type { JapaneseOcrError, JapaneseOcrErrorCode } from './definitions';
import { createJapaneseOcr } from './engine-switch';

// Android runs the native ML Kit engine; the web engine (PaddleOCR in the browser) runs on the
// web, on iOS, and on Android after setEngine({ engine: 'web' }).
const JapaneseOcr = createJapaneseOcr();

export * from './definitions';
export { findText } from './find-text';
export type { TextMatch } from './find-text';
export { toRubyHtml } from './ruby';
export { JapaneseOcr };

const ERROR_CODES: readonly JapaneseOcrErrorCode[] = [
  'UNAVAILABLE',
  'NOT_READY',
  'PERMISSION_DENIED',
  'CAMERA_ERROR',
  'ALREADY_RUNNING',
  'NOT_RUNNING',
  'INVALID_ARGUMENT',
  'RECOGNITION_FAILED',
  'CANCELLED',
  'HANDWRITING_NOT_READY',
];

/**
 * Type guard for errors thrown by the plugin.
 *
 * ```ts
 * try { await JapaneseOcr.startLiveRecognition(); }
 * catch (e) { if (isJapaneseOcrError(e) && e.code === 'PERMISSION_DENIED') { ... } }
 * ```
 */
export function isJapaneseOcrError(error: unknown): error is JapaneseOcrError {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code);
}
