import { createJapaneseOcr } from './engine-switch';

// Android runs the native ML Kit engine; the web engine (PaddleOCR in the browser) runs on the
// web, on iOS, and on Android after setEngine({ engine: 'web' }). It loads on first use.
const JapaneseOcr = createJapaneseOcr({ web: () => import('./web').then((m) => new m.JapaneseOcrWeb()) });

export * from './shared';
export { configureWebEngine } from './web-options';
export type { WebEngineOptions } from './web-options';
export { JapaneseOcr };
