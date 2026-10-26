import { createJapaneseOcr } from './engine-switch';

// Native engine (ML Kit on Android) only: apps that never use the web engine import this entry
// (`capacitor-japanese-ocr/native`), so bundlers leave the web engine and its models (about 25 MB) out.
const JapaneseOcr = createJapaneseOcr();

export * from './shared';
export { JapaneseOcr };
