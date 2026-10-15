import { registerPlugin } from '@capacitor/core';

import type { JapaneseOcrPlugin } from './definitions';

const loadUnsupported = () => import('./web').then((m) => new m.JapaneseOcrWeb());

// Android is native. Web and iOS get the unsupported implementation, so
// isDeviceSupported() answers instead of throwing "not implemented".
const JapaneseOcr = registerPlugin<JapaneseOcrPlugin>('JapaneseOcr', {
  web: loadUnsupported,
  ios: loadUnsupported,
});

export * from './definitions';
export { JapaneseOcr };
