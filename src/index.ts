import { registerPlugin } from '@capacitor/core';

import type { JapaneseOcrError, JapaneseOcrErrorCode, JapaneseOcrPlugin } from './definitions';

const loadUnsupported = () => import('./web').then((m) => new m.JapaneseOcrWeb());

// Android is native. Web and iOS get the unsupported implementation, so
// isDeviceSupported() answers instead of throwing "not implemented".
const JapaneseOcr = registerPlugin<JapaneseOcrPlugin>('JapaneseOcr', {
  web: loadUnsupported,
  ios: loadUnsupported,
});

export * from './definitions';
export { findText } from './find-text';
export type { TextMatch } from './find-text';
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
  'TRANSLATION_NOT_READY',
  'TRANSLATION_FAILED',
  'CANCELLED',
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
